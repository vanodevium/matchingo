/**
 * High-performance skip list SORTED MAPS (key -> value) for Node.js.
 *
 * Same design as skiplist.js: all nodes live inside one ArrayBuffer
 * ([key(2 words) | height | pad | next0..nextH-1]), a node id is its word
 * offset, a sentinel tail (key = +Infinity) removes null checks from the hot
 * loop, p = 1/4, one xor shift32 draw per insert, per-height free lists.
 *
 * Values are stored in a plain JS array indexed by (nodeId >> 1), so they can
 * be anything (objects, strings, undefined, ...).
 *
 * Exports:
 *  - SkipListMap         numeric keys (Float64), any values. Fastest. NaN rejected.
 *  - SkipListGenericMap  any keys + comparator, any values.
 *
 * Iteration notes: deleting the CURRENT entry while iterating is safe. Other
 * mutations during iteration (adding, deleting other entries) are not supported.
 */

const MAX_LENGTH = 16; // max height; 4^16 ~ 4e9 entries
const HEAD = 4; // head node id (tail sentinel occupies ids 0..3)
const HEAD_WORDS = 4 + MAX_LENGTH;

function nextPow2(n) {
	let p = 64;
	while (p < n) p *= 2;
	return p;
}

// ---------------------------------------------------------------------------
// Numeric-key sorted map
// ---------------------------------------------------------------------------
class SkipListMap {
	/** @param {number} [capacity] expected number of entries (pre-sizes memory) */
	constructor(capacity = 1024) {
		this.cap = nextPow2(HEAD + HEAD_WORDS + capacity * 6);
		const buf = new ArrayBuffer(this.cap * 4);
		this.i = new Int32Array(buf);
		this.f = new Float64Array(buf);
		this.f[0] = Infinity; // tail sentinel key
		this.i[HEAD + 2] = MAX_LENGTH; // head height
		this.vals = []; // vals[id >> 1]; kept packed (no holes)
		for (let k = this.cap >> 1; k > 0; k--) this.vals.push(undefined);
		this.top = HEAD + HEAD_WORDS; // bump pointer (words)
		this.level = 1; // highest level in use
		this.size = 0;
		this.seed = 0x9e3779b9 | 0;
		this.upd = new Int32Array(MAX_LENGTH); // scratch: predecessors per level
		this.free = new Int32Array(MAX_LENGTH + 1); // free-list heads per height
	}

	_grow(minWords) {
		let cap = this.cap;
		while (cap < minWords) cap *= 2;
		const buf = new ArrayBuffer(cap * 4);
		const i = new Int32Array(buf);
		i.set(this.i);
		this.i = i;
		this.f = new Float64Array(buf);
		const vals = this.vals;
		for (let k = cap >> 1; vals.length < k; ) vals.push(undefined);
		this.cap = cap;
	}

	_height() {
		let s = this.seed;
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		this.seed = s;
		// trailing zero pairs -> geometric distribution with p = 1/4
		return 1 + ((31 - Math.clz32(s & -s)) >> 1);
	}

	/** Insert or overwrite. Returns this (like Map#set). */
	set(key, value) {
		if (Number.isNaN(key)) throw new TypeError("NaN is not a valid key");
		let f = this.f,
			i = this.i;
		const upd = this.upd;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (f[n >> 1] < key) {
				x = n;
				n = i[x + 4 + l];
			}
			upd[l] = x;
		}
		const nx = i[x + 4];
		if (nx !== 0 && f[nx >> 1] === key) {
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
			const words = (5 + h) & ~1; // 4 + h rounded up to even
			id = this.top;
			if (id + words > this.cap) {
				this._grow(id + words);
				f = this.f;
				i = this.i;
			}
			this.top = id + words;
			i[id + 2] = h;
		}
		f[id >> 1] = key;
		this.vals[id >> 1] = value;
		for (let l = 0; l < h; l++) {
			const p = upd[l] + 4 + l;
			i[id + 4 + l] = i[p];
			i[p] = id;
		}
		this.size++;
		return this;
	}

	/** @returns the value, or undefined if the key is missing */
	get(key) {
		const f = this.f,
			i = this.i;
		let x = HEAD,
			n = 0;
		for (let l = this.level - 1; l >= 0; l--) {
			n = i[x + 4 + l];
			while (f[n >> 1] < key) {
				x = n;
				n = i[x + 4 + l];
			}
		}
		return n !== 0 && f[n >> 1] === key ? this.vals[n >> 1] : undefined;
	}

	has(key) {
		const f = this.f,
			i = this.i;
		let x = HEAD,
			n = 0;
		for (let l = this.level - 1; l >= 0; l--) {
			n = i[x + 4 + l];
			while (f[n >> 1] < key) {
				x = n;
				n = i[x + 4 + l];
			}
		}
		return n !== 0 && f[n >> 1] === key;
	}

	/** @returns {boolean} true if the key was present */
	delete(key) {
		const f = this.f,
			i = this.i;
		const upd = this.upd;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (f[n >> 1] < key) {
				x = n;
				n = i[x + 4 + l];
			}
			upd[l] = x;
		}
		const n = i[x + 4];
		if (n === 0 || f[n >> 1] !== key) return false;
		this._unlink(n);
		return true;
	}

	// unlink node n using the predecessors currently stored in this.upd
	_unlink(n) {
		const i = this.i,
			upd = this.upd;
		const h = i[n + 2];
		for (let l = 0; l < h; l++) {
			const p = upd[l] + 4 + l;
			if (i[p] !== n) break;
			i[p] = i[n + 4 + l];
		}
		while (this.level > 1 && i[HEAD + 4 + this.level - 1] === 0) this.level--;
		this.vals[n >> 1] = undefined; // release value for GC
		i[n + 4] = this.free[h]; // push to free list
		this.free[h] = n;
		this.size--;
	}

	// last node with node.key < key (or HEAD)
	_lt(key) {
		const f = this.f,
			i = this.i;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (f[n >> 1] < key) {
				x = n;
				n = i[x + 4 + l];
			}
		}
		return x;
	}

	// last node with node.key <= key (or HEAD)
	_le(key) {
		const f = this.f,
			i = this.i;
		let x = HEAD;
		for (let l = this.level - 1; l >= 0; l--) {
			let n = i[x + 4 + l];
			while (n !== 0 && f[n >> 1] <= key) {
				x = n;
				n = i[x + 4 + l];
			}
		}
		return x;
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
			: [this.f[n >> 1], this.vals[n >> 1]];
	}

	// ---- navigation: each returns [key, value] or undefined -----------------
	firstEntry() {
		return this._entry(this.i[HEAD + 4]);
	}
	lastEntry() {
		return this._entry(this._last());
	}
	/** smallest entry with key >= given key */
	ceilingEntry(key) {
		return this._entry(this.i[this._lt(key) + 4]);
	}
	/** smallest entry with key > given key */
	higherEntry(key) {
		return this._entry(this.i[this._le(key) + 4]);
	}
	/** largest entry with key <= given key */
	floorEntry(key) {
		return this._entry(this._le(key));
	}
	/** largest entry with key < given key */
	lowerEntry(key) {
		return this._entry(this._lt(key));
	}

	firstKey() {
		const n = this.i[HEAD + 4];
		return n === 0 ? undefined : this.f[n >> 1];
	}
	lastKey() {
		const n = this._last();
		return n === HEAD ? undefined : this.f[n >> 1];
	}

	/** remove and return the smallest entry */
	pollFirstEntry() {
		const e = this.firstEntry();
		if (e !== undefined) this.delete(e[0]);
		return e;
	}

	/** remove and return the largest entry */
	pollLastEntry() {
		const e = this.lastEntry();
		if (e !== undefined) this.delete(e[0]);
		return e;
	}

	clear() {
		this.i.fill(0, HEAD + 4, HEAD + HEAD_WORDS);
		this.free.fill(0);
		this.vals.fill(undefined);
		this.top = HEAD + HEAD_WORDS;
		this.level = 1;
		this.size = 0;
	}

	/** fn(value, key, map) in ascending key order (Map-compatible signature) */
	forEach(fn) {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4]; // read next first: current may be deleted
			fn(this.vals[n >> 1], this.f[n >> 1], this);
			n = nx;
		}
	}

	*entries() {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4];
			yield [this.f[n >> 1], this.vals[n >> 1]];
			n = nx;
		}
	}

	*keys() {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4];
			yield this.f[n >> 1];
			n = nx;
		}
	}

	*values() {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4];
			yield this.vals[n >> 1];
			n = nx;
		}
	}

	/** entries with lo <= key < hi, ascending */
	*range(lo, hi) {
		for (let n = this.i[this._lt(lo) + 4]; n !== 0; ) {
			const k = this.f[n >> 1];
			if (k >= hi) return;
			const nx = this.i[n + 4];
			yield [k, this.vals[n >> 1]];
			n = nx;
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}

// ---------------------------------------------------------------------------
// Generic sorted map (custom comparator, any key type)
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
		this.cap = nextPow2(HEAD + HEAD_WORDS + capacity * 6);
		this.i = new Int32Array(this.cap);
		this.i[HEAD + 2] = MAX_LENGTH;
		this.ks = []; // ks[id >> 1]
		this.vals = []; // vals[id >> 1]
		for (let k = this.cap >> 1; k > 0; k--) {
			this.ks.push(undefined);
			this.vals.push(undefined);
		}
		this.top = HEAD + HEAD_WORDS;
		this.level = 1;
		this.size = 0;
		this.seed = 0x9e3779b9 | 0;
		this.upd = new Int32Array(MAX_LENGTH);
		this.free = new Int32Array(MAX_LENGTH + 1);
	}

	_grow(minWords) {
		let cap = this.cap;
		while (cap < minWords) cap *= 2;
		const i = new Int32Array(cap);
		i.set(this.i);
		this.i = i;
		const ks = this.ks,
			vals = this.vals;
		for (let k = cap >> 1; ks.length < k; ) {
			ks.push(undefined);
			vals.push(undefined);
		}
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

	// first node with node.key >= key (or 0)
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

	has(key) {
		const n = this._find(key);
		return n !== 0 && this.cmp(this.ks[n >> 1], key) === 0;
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
		ks[n >> 1] = undefined; // release references for GC
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
	/** smallest entry with key >= given key */
	ceilingEntry(key) {
		return this._entry(this._find(key));
	}

	pollFirstEntry() {
		const e = this.firstEntry();
		if (e !== undefined) this.delete(e[0]);
		return e;
	}

	pollLastEntry() {
		const e = this.lastEntry();
		if (e !== undefined) this.delete(e[0]);
		return e;
	}

	clear() {
		this.i.fill(0, HEAD + 4, HEAD + HEAD_WORDS);
		this.free.fill(0);
		this.ks.fill(undefined);
		this.vals.fill(undefined);
		this.top = HEAD + HEAD_WORDS;
		this.level = 1;
		this.size = 0;
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

	*keys() {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4];
			yield this.ks[n >> 1];
			n = nx;
		}
	}

	*values() {
		for (let n = this.i[HEAD + 4]; n !== 0; ) {
			const nx = this.i[n + 4];
			yield this.vals[n >> 1];
			n = nx;
		}
	}

	/** entries with lo <= key < hi, ascending */
	*range(lo, hi) {
		for (let n = this._find(lo); n !== 0; ) {
			const k = this.ks[n >> 1];
			if (this.cmp(k, hi) >= 0) return;
			const nx = this.i[n + 4];
			yield [k, this.vals[n >> 1]];
			n = nx;
		}
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}

// ---------------------------------------------------------------------------
// SkipList: adapter that provides the sonic-forest SkipList API on top of
// SkipListGenericMap. Used by ordered-set-orders-queue.js and
// ordered-set-numbers.js as a drop-in replacement for the red-black tree.
//
// API: set(k,v), get(k), del(k), find(k), has(k), size(), isEmpty(),
//      clear(), forEach(cb), first(), last(), iterator(), iterator0(),
//      entries(), getOrNextLower(k)
//
// Callbacks and iterators yield { k, v } objects (not [k, v] arrays).
// ---------------------------------------------------------------------------
class SkipList {
	/** @param {(a,b)=>number} [comparator] */
	constructor(comparator) {
		this._map = new SkipListGenericMap(comparator);
	}

	size() {
		return this._map.size;
	}
	isEmpty() {
		return this._map.size === 0;
	}

	set(key, value) {
		this._map.set(key, value);
		return this;
	}
	get(key) {
		return this._map.get(key);
	}
	has(key) {
		return this._map.has(key);
	}

	/** Alias for delete (sonic-forest convention). */
	del(key) {
		return this._map.delete(key);
	}

	/** Returns { k, v } or undefined. */
	find(key) {
		const v = this._map.get(key);
		return v !== undefined ? { k: key, v } : undefined;
	}

	clear() {
		this._map.clear();
	}

	/** Callback receives { k, v } for each entry in sorted order. */
	forEach(callback) {
		this._map.forEach((v, k) => {
			callback({ k, v });
		});
	}

	/** Returns { k, v } for the first entry, or undefined. */
	first() {
		const e = this._map.firstEntry();
		return e ? { k: e[0], v: e[1] } : undefined;
	}

	/** Returns { k, v } for the last entry, or undefined. */
	last() {
		const e = this._map.lastEntry();
		return e ? { k: e[0], v: e[1] } : undefined;
	}

	/** Returns an iterator yielding { k, v } in sorted order. */
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

	/** Alias for iterator(). */
	iterator0() {
		return this.iterator();
	}

	/** Alias for iterator(). */
	entries() {
		return this.iterator();
	}

	/** Returns { k, v } for key, or the next higher key's entry. */
	getOrNextLower(key) {
		const e = this._map.ceilingEntry(key);
		return e ? { k: e[0], v: e[1] } : undefined;
	}
}

export { SkipList, SkipListGenericMap, SkipListMap };
