// Memory layout of buf (Int32Array):
//
//   Words 0–3   : null sentinel — node id 0 means "no node"
//   Words 4–23  : HEAD node (id = HEAD): height = MAX_HEIGHT, fwd[0..15]
//   Words 24+   : regular nodes, allocated upward from `top`
//
// Each node at word offset `id`:
//   buf[id + 2]            : height h  (1 – MAX_HEIGHT)
//   buf[id + 4 .. id+4+h-1]: forward pointers, one per level
//   node size in words     : (5 + h) & ~1   — rounded up to even so
//                            (id >> 1) is a unique index into keys[] / vals[]
//
// Free lists: _free[h] is the head of the recycled-node list for height h.
// Nodes of different heights have different sizes, so each height has its own list.

const MAX_HEIGHT = 16; // supports up to 4^16 ≈ 4 billion entries
const HEAD = 4; // word offset of the head sentinel node
const HEAD_WORDS = 4 + MAX_HEIGHT;

function nextPow2(n) {
	let p = 64;
	while (p < n) p *= 2;
	return p;
}

/**
 * Sorted map backed by a skip list.
 *
 * O(log n) insert, lookup and delete with a custom comparator.
 * Uses a flat Int32Array for node storage — no per-node heap objects.
 * Callbacks and iterators yield `{ k, v }` objects.
 *
 * @template K, V
 */
class SkipList {
	/** @param {(a:K, b:K) => number} [comparator] */
	constructor(comparator) {
		this.cmp = comparator ?? ((a, b) => (a < b ? -1 : a > b ? 1 : 0));

		const cap = nextPow2(HEAD + HEAD_WORDS + 1024 * 6);
		this.buf = new Int32Array(cap);
		this.buf[HEAD + 2] = MAX_HEIGHT;
		this.keys = new Array(cap >> 1);
		this.vals = new Array(cap >> 1);
		this.cap = cap;
		this.top = HEAD + HEAD_WORDS; // bump pointer for new nodes
		this.level = 1; // current highest level in use
		this._size = 0;
		this._seed = 0x9e3779b9 | 0;
		this._upd = new Int32Array(MAX_HEIGHT); // reused scratch for set/delete
		this._free = new Int32Array(MAX_HEIGHT + 1);
	}

	// xorshift32 → count trailing zeros / 2, capped at MAX_HEIGHT
	_height() {
		let s = this._seed;
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		this._seed = s;
		return 1 + ((31 - Math.clz32(s & -s)) >> 1);
	}

	_grow(minWords) {
		let cap = this.cap;
		while (cap < minWords) cap *= 2;
		const buf = new Int32Array(cap);
		buf.set(this.buf);
		this.buf = buf;
		const half = cap >> 1;
		const keys = new Array(half);
		const vals = new Array(half);
		for (let j = 0; j < this.keys.length; j++) {
			keys[j] = this.keys[j];
			vals[j] = this.vals[j];
		}
		this.keys = keys;
		this.vals = vals;
		this.cap = cap;
	}

	/** Insert or update an entry. @returns {this} */
	set(key, value) {
		const { buf, keys, cmp, _upd: upd } = this;
		let prev = HEAD;

		// Walk down from the highest level, recording the last node per level
		// that is strictly less than key (the "update" array for splicing).
		for (let l = this.level - 1; l >= 0; l--) {
			let node = buf[prev + 4 + l];
			while (node !== 0 && cmp(keys[node >> 1], key) < 0) {
				prev = node;
				node = buf[prev + 4 + l];
			}
			upd[l] = prev;
		}

		// If the key already exists at level 0, just update the value.
		const next = buf[prev + 4];
		if (next !== 0 && cmp(keys[next >> 1], key) === 0) {
			this.vals[next >> 1] = value;
			return this;
		}

		const h = this._height();
		if (h > this.level) {
			for (let l = this.level; l < h; l++) upd[l] = HEAD;
			this.level = h;
		}

		// Allocate a node: recycle from the free list first, else bump top.
		let id = this._free[h];
		if (id !== 0) {
			this._free[h] = buf[id + 4];
		} else {
			const words = (5 + h) & ~1;
			id = this.top;
			if (id + words > this.cap) {
				this._grow(id + words);
				// buf reference is stale after grow
			}
			this.top = id + words;
			this.buf[id + 2] = h;
		}

		this.keys[id >> 1] = key;
		this.vals[id >> 1] = value;

		// Splice the new node into every level it participates in.
		const b = this.buf;
		for (let l = 0; l < h; l++) {
			const slot = upd[l] + 4 + l;
			b[id + 4 + l] = b[slot];
			b[slot] = id;
		}
		this._size++;
		return this;
	}

	/** @returns {V|undefined} */
	get(key) {
		const { buf, keys, cmp } = this;
		let prev = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let node = buf[prev + 4 + l];
			while (node !== 0 && cmp(keys[node >> 1], key) < 0) {
				prev = node;
				node = buf[prev + 4 + l];
			}
		}
		const node = buf[prev + 4];
		return node !== 0 && cmp(keys[node >> 1], key) === 0
			? this.vals[node >> 1]
			: undefined;
	}

	/** Delete by key. @returns {boolean} */
	del(key) {
		const { buf, keys, cmp, _upd: upd } = this;
		let prev = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let node = buf[prev + 4 + l];
			while (node !== 0 && cmp(keys[node >> 1], key) < 0) {
				prev = node;
				node = buf[prev + 4 + l];
			}
			upd[l] = prev;
		}

		const node = buf[prev + 4];
		if (node === 0 || cmp(keys[node >> 1], key) !== 0) return false;

		const h = buf[node + 2];
		for (let l = 0; l < h; l++) {
			const slot = upd[l] + 4 + l;
			if (buf[slot] !== node) break;
			buf[slot] = buf[node + 4 + l];
		}
		while (this.level > 1 && buf[HEAD + 4 + this.level - 1] === 0) this.level--;

		// Release the key/value references so the GC can collect them.
		const half = node >> 1;
		this.keys[half] = undefined;
		this.vals[half] = undefined;

		// Return the node to the free list for its height.
		buf[node + 4] = this._free[h];
		this._free[h] = node;
		this._size--;
		return true;
	}

	/** @returns {number} */
	size() {
		return this._size;
	}

	/** @returns {{k: K, v: V}|undefined} */
	find(key) {
		const v = this.get(key);
		return v !== undefined ? { k: key, v } : undefined;
	}

	/** @returns {{k: K, v: V}|undefined} first entry in sorted order */
	first() {
		const node = this.buf[HEAD + 4];
		return node === 0
			? undefined
			: { k: this.keys[node >> 1], v: this.vals[node >> 1] };
	}

	/** @returns {{k: K, v: V}|undefined} last entry in sorted order */
	last() {
		const { buf, keys, vals } = this;
		let prev = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let node = buf[prev + 4 + l];
			while (node !== 0) {
				prev = node;
				node = buf[prev + 4 + l];
			}
		}
		return prev === HEAD
			? undefined
			: { k: keys[prev >> 1], v: vals[prev >> 1] };
	}

	/** Iterate in sorted order. Callback receives `{ k, v }`. */
	forEach(callback) {
		const { buf, keys, vals } = this;
		for (let node = buf[HEAD + 4]; node !== 0; node = buf[node + 4]) {
			callback({ k: keys[node >> 1], v: vals[node >> 1] });
		}
	}

	/** @returns {Iterator<{k: K, v: V}>} */
	iterator() {
		const { buf, keys, vals } = this;
		let node = buf[HEAD + 4];
		return {
			next() {
				if (node === 0) return { done: true, value: undefined };
				const value = { k: keys[node >> 1], v: vals[node >> 1] };
				node = buf[node + 4];
				return { done: false, value };
			},
		};
	}
}

export { SkipList };
