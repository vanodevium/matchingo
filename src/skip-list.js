const MAX_HEIGHT = 16; // 4^16 ≈ 4 billion entries
const HEAD = 4; // head node id (tail sentinel occupies ids 0..3)
const HEAD_WORDS = 4 + MAX_HEIGHT;

function _nextPow2(n) {
	let p = 64;
	while (p < n) p *= 2;
	return p;
}

// ---------------------------------------------------------------------------
// Internal: generic sorted map backed by a skip list
// ---------------------------------------------------------------------------
class SkipListGenericMap {
	/**
	 * @param {(a:any,b:any)=>number} [compare] negative / 0 / positive
	 * @param {number} [capacity]
	 */
	constructor(
		compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0),
		capacity = 1024,
	) {
		this.cmp = compare;
		this.cap = _nextPow2(HEAD + HEAD_WORDS + capacity * 6);
		this.i = new Int32Array(this.cap);
		this.i[HEAD + 2] = MAX_HEIGHT;
		this.ks = new Array(this.cap >> 1);
		this.vals = new Array(this.cap >> 1);
		this.top = HEAD + HEAD_WORDS;
		this.level = 1;
		this.size = 0;
		this.seed = 0x9e3779b9 | 0;
		this.upd = new Int32Array(MAX_HEIGHT);
		this.free = new Int32Array(MAX_HEIGHT + 1);
	}

	_grow(minWords) {
		let cap = this.cap;
		while (cap < minWords) cap *= 2;
		const i = new Int32Array(cap);
		i.set(this.i);
		this.i = i;
		const half = cap >> 1;
		this.ks = Object.assign(new Array(half), this.ks);
		this.vals = Object.assign(new Array(half), this.vals);
		this.cap = cap;
	}

	_height() {
		let s = this.seed;
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		this.seed = s;
		return 1 + ((31 - Math.clz32(s & -s)) >> 1);
	}

	set(key, value) {
		let i = this.i;
		const ks = this.ks,
			cmp = this.cmp,
			upd = this.upd;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (n !== 0 && cmp(ks[n >> 1], key) < 0) {
				x = n;
				n = i[x + 4 + l];
			}
			upd[l] = x;
		}
		const nx = i[x + 4];
		if (nx !== 0 && cmp(ks[nx >> 1], key) === 0) {
			this.vals[nx >> 1] = value;
			return this;
		}

		const h = this._height();
		if (h > this.level) {
			for (let l = this.level; l < h; l++) upd[l] = HEAD;
			this.level = h;
		}
		let id = this.free[h];
		if (id !== 0) {
			this.free[h] = i[id + 4];
		} else {
			const words = (5 + h) & ~1;
			id = this.top;
			if (id + words > this.cap) {
				this._grow(id + words);
				i = this.i;
			}
			this.top = id + words;
			i[id + 2] = h;
		}
		ks[id >> 1] = key;
		this.vals[id >> 1] = value;
		for (let l = 0; l < h; l++) {
			const p = upd[l] + 4 + l;
			i[id + 4 + l] = i[p];
			i[p] = id;
		}
		this.size++;
		return this;
	}

	_find(key) {
		const i = this.i,
			ks = this.ks,
			cmp = this.cmp;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (n !== 0 && cmp(ks[n >> 1], key) < 0) {
				x = n;
				n = i[x + 4 + l];
			}
		}
		return i[x + 4];
	}

	get(key) {
		const n = this._find(key);
		return n !== 0 && this.cmp(this.ks[n >> 1], key) === 0
			? this.vals[n >> 1]
			: undefined;
	}
	delete(key) {
		const i = this.i,
			ks = this.ks,
			cmp = this.cmp,
			upd = this.upd;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (n !== 0 && cmp(ks[n >> 1], key) < 0) {
				x = n;
				n = i[x + 4 + l];
			}
			upd[l] = x;
		}
		const n = i[x + 4];
		if (n === 0 || cmp(ks[n >> 1], key) !== 0) return false;

		const h = i[n + 2];
		for (let l = 0; l < h; l++) {
			const p = upd[l] + 4 + l;
			if (i[p] !== n) break;
			i[p] = i[n + 4 + l];
		}
		while (this.level > 1 && i[HEAD + 4 + this.level - 1] === 0) this.level--;
		ks[n >> 1] = undefined;
		this.vals[n >> 1] = undefined;
		i[n + 4] = this.free[h];
		this.free[h] = n;
		this.size--;
		return true;
	}

	_last() {
		const i = this.i;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (n !== 0) {
				x = n;
				n = i[x + 4 + l];
			}
		}
		return x;
	}

	_entry(n) {
		return n === 0 || n === HEAD
			? undefined
			: [this.ks[n >> 1], this.vals[n >> 1]];
	}

	firstEntry() {
		return this._entry(this.i[HEAD + 4]);
	}
	lastEntry() {
		return this._entry(this._last());
	}
	forEach(fn) {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4];
			fn(this.vals[n >> 1], this.ks[n >> 1], this);
			n = nx;
		}
	}

	*entries() {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4];
			yield [this.ks[n >> 1], this.vals[n >> 1]];
			n = nx;
		}
	}
}

/**
 * Sorted map backed by a skip list.
 *
 * Provides O(log n) insert, lookup, and delete with a custom comparator.
 * Callbacks and iterators yield `{ k, v }` objects.
 *
 * @template K, V
 */
class SkipList {
	/**
	 * @param {(a:K, b:K) => number} [comparator] — returns <0, 0, or >0
	 */
	constructor(comparator) {
		/** @private */
		this._map = new SkipListGenericMap(comparator);
	}

	/** @returns {number} Number of entries */
	size() {
		return this._map.size;
	}
	/** Insert or update. @returns {this} */
	set(key, value) {
		this._map.set(key, value);
		return this;
	}

	/** @returns {V|undefined} */
	get(key) {
		return this._map.get(key);
	}
	/** Delete by key. @returns {boolean} */
	del(key) {
		return this._map.delete(key);
	}

	/** @returns {{k: K, v: V}|undefined} */
	find(key) {
		const v = this._map.get(key);
		return v !== undefined ? { k: key, v } : undefined;
	}

	/** Iterate in sorted order. Callback receives `{ k, v }`. */
	forEach(callback) {
		this._map.forEach((v, k) => {
			callback({ k, v });
		});
	}

	/** @returns {{k: K, v: V}|undefined} */
	first() {
		const e = this._map.firstEntry();
		return e ? { k: e[0], v: e[1] } : undefined;
	}

	/** @returns {{k: K, v: V}|undefined} */
	last() {
		const e = this._map.lastEntry();
		return e ? { k: e[0], v: e[1] } : undefined;
	}

	/** @returns {Iterator<{k: K, v: V}>} */
	iterator() {
		const it = this._map.entries();
		return {
			next() {
				const result = it.next();
				if (result.done) return { done: true, value: undefined };
				const [k, v] = result.value;
				return { done: false, value: { k, v } };
			},
		};
	}
}

export { SkipList };
