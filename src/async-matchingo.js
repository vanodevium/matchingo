import Matchingo from "./matchingo.js";

const COMMANDS = [
	"submit",
	"replace",
	"cancel",
	"modify",
	"modifyStop",
	"expire",
	"halt",
	"resume",
	"restore",
	"replay",
	"attachWal",
];
const QUERIES = [
	"order",
	"depth",
	"bestBid",
	"bestAsk",
	"level",
	"estimate",
	"dump",
];

/**
 * Makes a Matchingo safe for concurrent async callers. Every command takes
 * an exclusive lock, so it runs atomically and the result equals some
 * sequential order of the commands (the order the WAL records). Queries share
 * a read lock: they run together, never during a command.
 *
 * Event listeners and the WAL sink run under the lock. They must not wait
 * for this wrapper, or they deadlock.
 */
export class AsyncMatchingo {
	/**
	 * @param {Matchingo} book
	 */
	constructor(book) {
		this.book = book;
		this._readers = 0;
		this._writing = false;
		this._queue = [];

		for (const name of COMMANDS) {
			this[name] = (...args) => this._lock(true, () => book[name](...args));
		}
		for (const name of QUERIES) {
			this[name] = (...args) => this._lock(false, () => book[name](...args));
		}
		for (const name of Object.getOwnPropertyNames(Matchingo.prototype)) {
			if (name.startsWith("new")) {
				this[name] = (...args) => book[name](...args);
			}
		}
	}

	_lock(exclusive, fn) {
		return new Promise((resolve, reject) => {
			this._queue.push({ exclusive, fn, resolve, reject });
			this._next();
		});
	}

	_next() {
		while (this._queue.length > 0 && !this._writing) {
			const job = this._queue[0];
			if (job.exclusive && this._readers > 0) {
				return;
			}
			this._queue.shift();
			this._start(job);
		}
	}

	async _start({ exclusive, fn, resolve, reject }) {
		if (exclusive) {
			this._writing = true;
		} else {
			this._readers++;
		}
		try {
			resolve(await fn());
		} catch (error) {
			reject(error);
		} finally {
			if (exclusive) {
				this._writing = false;
			} else {
				this._readers--;
			}
			this._next();
		}
	}
}
