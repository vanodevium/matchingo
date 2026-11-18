import {
	BUY,
	FOK,
	GTC,
	GTD,
	IOC,
	LIMIT,
	MAKER,
	MARKET,
	SELL,
	STOP_LIMIT,
	STOP_MARKET,
	STP_CANCEL_BOTH,
	STP_CANCEL_NEWEST,
	STP_CANCEL_OLDEST,
	STP_DECREMENT,
	STP_NONE,
	TAKER,
	TRAILING_STOP,
} from "./constants.js";
import { baseOf, checkScale, fromInt, quoteOf, toInt } from "./decimal.js";
import Emitter from "./emmiter.js";
import { ErrorCode, MatchingoError } from "./errors.js";
import Done from "./models/done.js";
import Order from "./models/order.js";
import {
	createLimitOrder,
	createMarketOrder,
	createStopLimitOrder,
	createStopMarketOrder,
	createTrailingStopOrder,
} from "./new-order.js";
import OrderBook from "./order-book.js";
import StopBook from "./stop-book.js";
import { checkRecord } from "./wal.js";

/**
 * @typedef {1|2} Side
 */

const TYPES = new Set([MARKET, LIMIT, STOP_LIMIT, STOP_MARKET, TRAILING_STOP]);
const TIFS = new Set([GTC, IOC, FOK, GTD]);
const STPS = new Set([
	STP_NONE,
	STP_CANCEL_NEWEST,
	STP_CANCEL_OLDEST,
	STP_CANCEL_BOTH,
	STP_DECREMENT,
]);
const SNAPSHOT_VERSION = 2;

const compareIds = (a, b) => {
	if (typeof a === "number" && typeof b === "number") {
		return a - b;
	}
	const [x, y] = [String(a), String(b)];
	return x < y ? -1 : x > y ? 1 : 0;
};

const fail = (code, message) => {
	throw new MatchingoError(code, message);
};

/**
 * @param {string} symbol
 * @param {object} options
 * @param {number} options.priceScale digits after the point of prices
 * @param {number} options.amountScale digits after the point of amounts
 * @param {object} [options.instrument] tickSize, lotSize, minQuantity,
 *   maxQuantity, minPrice, maxPrice (decimals; zero or missing: unchecked)
 * @param {number} [options.circuitBreaker] percent of price move that halts trading
 * @param {() => number} [options.clock] unix ms time source
 * @param {boolean} [options.emitter] create `matchingo.emitter`
 * @param {{write: (line: string) => void, sync?: () => void}} [options.wal]
 */
export default class Matchingo {
	constructor(
		symbol,
		{
			priceScale,
			amountScale,
			instrument,
			circuitBreaker,
			clock,
			emitter,
			wal,
		} = {},
	) {
		if (!symbol) {
			throw new Error("please set up symbol");
		}
		checkScale("priceScale", priceScale);
		checkScale("amountScale", amountScale);

		this._ps = priceScale;
		this._as = amountScale;
		this._quoteDivisor = 10 ** amountScale;

		this._ins = this._instrument(instrument || {});
		if (
			circuitBreaker !== undefined &&
			!(typeof circuitBreaker === "number" && circuitBreaker > 0)
		) {
			throw new Error("circuitBreaker must be a positive number");
		}
		this._breaker = circuitBreaker || 0;
		this._clock = clock || Date.now;

		this.symbol = symbol;
		this.orderBook = new OrderBook(this.symbol);
		this.stopBook = new StopBook(this.symbol);

		this._seq = 0;
		this._tradeId = 0;
		this._lsn = 0;
		this._halted = false;
		this._lastPrice = 0;
		this._oco = new Set();
		this._trailing = new Map();
		this._hidden = { [BUY]: new Map(), [SELL]: new Map() };
		this._nextExpiry = Number.POSITIVE_INFINITY;

		this._t = null;
		this._replaying = false;
		this._wal = wal || null;
		this._walError = null;

		this._emit = emitter || false;
		this.emitter = new Emitter(this.symbol);
	}

	// -----------------------------------------------------------------------
	// Order creation
	// -----------------------------------------------------------------------

	/**
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} baseAmount
	 * @returns {Order}
	 */
	newMarketOrder(id, side, baseAmount) {
		return createMarketOrder(this.symbol, id, side, this._amount(baseAmount));
	}

	/**
	 * Market order that takes liquidity and rests the remainder as a limit
	 * order at the price of its last fill.
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} baseAmount
	 * @returns {Order}
	 */
	newMarketToLimitOrder(id, side, baseAmount) {
		const order = this.newMarketOrder(id, side, baseAmount);
		order.toLimit = true;
		return order;
	}

	/**
	 * @param {string|number} id
	 * @param {number|string} quoteAmount
	 * @returns {Order}
	 */
	newMarketBuyQuoteOrder(id, quoteAmount) {
		return this._quoteOrder(id, BUY, quoteAmount);
	}

	/**
	 * @param {string|number} id
	 * @param {number|string} quoteAmount
	 * @returns {Order}
	 */
	newMarketSellQuoteOrder(id, quoteAmount) {
		return this._quoteOrder(id, SELL, quoteAmount);
	}

	/**
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} price
	 * @param {number|string} amount
	 * @returns {Order}
	 */
	newLimitOrder(id, side, price, amount) {
		const [p, a] = this._priceAmount(price, amount);
		return createLimitOrder(this.symbol, id, side, p, a);
	}

	/**
	 * Post-only limit order: canceled if it would immediately match.
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} price
	 * @param {number|string} amount
	 * @returns {Order}
	 */
	newPostOnlyLimitOrder(id, side, price, amount) {
		const order = this.newLimitOrder(id, side, price, amount);
		order.postOnly = true;
		return order;
	}

	/**
	 * Iceberg limit order: only peakAmount is visible at a time.
	 * When the peak is consumed, the order refills from its hidden reserve.
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} price
	 * @param {number|string} amount total quantity (visible + hidden)
	 * @param {number|string} peakAmount visible quantity per slice
	 * @returns {Order}
	 */
	newIcebergOrder(id, side, price, amount, peakAmount) {
		const order = this.newLimitOrder(id, side, price, amount);
		const peak = this._amount(peakAmount);
		if (peak >= order.amount) {
			fail(
				ErrorCode.INVALID_QUANTITY,
				`peakAmount must be less than amount: ${peakAmount} >= ${amount}`,
			);
		}
		order.peak = peak;
		order.shown = peak;
		return order;
	}

	/**
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} stop
	 * @param {number|string} price
	 * @param {number|string} amount
	 * @returns {Order}
	 */
	newStopLimitOrder(id, side, stop, price, amount) {
		const [p, a] = this._priceAmount(price, amount);
		return createStopLimitOrder(this.symbol, id, side, this._stop(stop), p, a);
	}

	/**
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} stop
	 * @param {number|string} amount
	 * @returns {Order}
	 */
	newStopMarketOrder(id, side, stop, amount) {
		return createStopMarketOrder(
			this.symbol,
			id,
			side,
			this._stop(stop),
			this._amount(amount),
		);
	}

	/**
	 * Stop-market order whose stop price follows the market at a fixed distance.
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number|string} stop initial stop price
	 * @param {number|string} amount
	 * @param {{offset?: number|string, percent?: number}} trail distance in
	 *   price units, or a percentage of the trade price (between 0 and 100)
	 * @returns {Order}
	 */
	newTrailingStopOrder(id, side, stop, amount, { offset, percent } = {}) {
		const order = createTrailingStopOrder(
			this.symbol,
			id,
			side,
			this._stop(stop),
			this._amount(amount),
		);
		if ((offset === undefined) === (percent === undefined)) {
			fail(
				ErrorCode.INVALID_PRICE,
				"trailing stop needs either offset or percent",
			);
		}
		if (offset !== undefined) {
			order.trailOffset = this._price(offset);
		} else {
			if (!(typeof percent === "number" && percent > 0 && percent < 100)) {
				fail(
					ErrorCode.INVALID_PRICE,
					`percent must be between 0 and 100: ${percent}`,
				);
			}
			order.trailPercent = percent;
		}
		return order;
	}

	// -----------------------------------------------------------------------
	// Commands
	// -----------------------------------------------------------------------

	/**
	 * Accept a new order, match it and return the result.
	 * Throws MatchingoError when the order is rejected; the book is unchanged.
	 * @param {Order} order
	 * @returns {Done}
	 */
	submit(order) {
		return this._run(
			"submit",
			() => ({ order: order.toRecord() }),
			() => this._validate(order),
			() => this._accept(order, []),
		);
	}

	/**
	 * Atomic cancel-and-submit. The new order is validated before anything
	 * is touched. It may reuse the old ID.
	 * @param {string|number} id the order to replace
	 * @param {Order} order
	 * @returns {Done}
	 */
	replace(id, order) {
		let old;
		return this._run(
			"replace",
			() => ({ id, order: order.toRecord() }),
			() => {
				this._validate(order, id);
				old = this._find(id);
				if (!old) {
					fail(ErrorCode.ORDER_NOT_FOUND, `order not found: ${id}`);
				}
			},
			() => {
				const canceled = [];
				this._removeOrder(old);
				this._markCanceled(old, canceled);
				return this._accept(order, canceled);
			},
		);
	}

	/**
	 * Remove a resting or dormant order. Works while trading is halted.
	 * @param {string|number} id
	 * @returns {boolean} false if there is no such order
	 */
	cancel(id) {
		if (this._walError) {
			throw this._walError;
		}
		if (!this._find(id)) {
			return false;
		}
		return this._run(
			"cancel",
			() => ({ id }),
			null,
			() => {
				const order = this._find(id);
				this._removeOrder(order);
				this._markCanceled(order, []);
				return true;
			},
		);
	}

	/**
	 * Modify a resting limit order. `newAmount` is the new unfilled amount.
	 *
	 * Same price and a smaller or equal amount: updates in place, keeps time
	 * priority. Anything else: the order is removed and submitted again at the
	 * back of the new level, and can match at once.
	 *
	 * @param {string|number} id
	 * @param {number|string} newPrice
	 * @param {number|string} newAmount
	 * @returns {Done}
	 */
	modify(id, newPrice, newAmount) {
		const [p, a] = this._priceAmount(newPrice, newAmount);
		return this._modify(id, p, a);
	}

	/**
	 * Modify a dormant stop order: stop price, limit price (ignored for
	 * stop-market orders) and amount. The order goes to the back of its new level.
	 * @param {string|number} id
	 * @param {number|string} newStop
	 * @param {number|string|null} newPrice
	 * @param {number|string} newAmount
	 * @returns {Done}
	 */
	modifyStop(id, newStop, newPrice, newAmount) {
		const stop = this._stop(newStop);
		const amount = this._amount(newAmount);
		const price = newPrice == null ? 0 : this._price(newPrice);
		return this._modifyStop(id, stop, price, amount);
	}

	/**
	 * Cancel every order whose expiry is reached at the given time.
	 * @param {number} [at] unix ms; the clock reading by default
	 * @returns {Array<string|number>} IDs of the canceled orders
	 */
	expire(at) {
		return this._run(
			"expire",
			() => ({ at: this._expireAt(at) }),
			null,
			() => this._purgeExpired(this._expireAt(at)),
		);
	}

	/**
	 * Reject new orders and amendments. Cancels and expiry still work.
	 */
	halt() {
		if (this._halted) {
			return;
		}
		this._run(
			"halt",
			() => ({}),
			null,
			() => this._setHalted(true, false),
		);
	}

	resume() {
		if (!this._halted) {
			return;
		}
		this._run(
			"resume",
			() => ({}),
			null,
			() => this._setHalted(false, false),
		);
	}

	// -----------------------------------------------------------------------
	// Queries
	// -----------------------------------------------------------------------

	/**
	 * @param {string|number} id
	 * @returns {?object} a copy of the order, or null
	 */
	order(id) {
		const order = this._find(id);
		return order ? this._publicOrder(order) : null;
	}

	get halted() {
		return this._halted;
	}

	depth() {
		const raw = this.orderBook.volume.getRaw()[this.symbol];
		const side = (volume) =>
			Object.fromEntries(
				Object.entries(volume).map(([price, amount]) => [
					fromInt(Number(price), this._ps),
					fromInt(amount, this._as),
				]),
			);
		const depth = {
			[this.symbol]: { [BUY]: side(raw[BUY]), [SELL]: side(raw[SELL]) },
		};
		this._ev("depth", { depth });
		return depth;
	}

	bestBid() {
		return this._best(BUY);
	}

	bestAsk() {
		return this._best(SELL);
	}

	/**
	 * @param {Side} side
	 * @param {number|string} price
	 * @returns {{price: number, amount: number}|null}
	 */
	level(side, price) {
		const p = toInt(price, this._ps);
		const amount = this.orderBook.volume[side].getRaw()[p];
		if (!amount) return null;
		return { price: fromInt(p, this._ps), amount: fromInt(amount, this._as) };
	}

	/**
	 * Cost (BUY) or proceeds (SELL) of taking `amount` from the opposite side,
	 * level by level. The book does not change.
	 * @param {Side} side
	 * @param {number|string} amount
	 * @returns {number}
	 */
	estimate(side, amount) {
		if (side !== BUY && side !== SELL) {
			fail(ErrorCode.INVALID_SIDE, `invalid side: ${side}`);
		}
		let need = this._amount(amount);
		const opposite = side === BUY ? SELL : BUY;
		const volume = this.orderBook.volume[opposite];
		const hidden = this._hidden[opposite];
		const levels = volume.geyKeys().iterator();
		let total = 0;
		for (
			let next = levels.next();
			need > 0 && !next.done;
			next = levels.next()
		) {
			const price = next.value.k;
			const take = Math.min(
				need,
				volume.getRaw()[price] + (hidden.get(price) || 0),
			);
			total += quoteOf(take, price, this._quoteDivisor);
			need -= take;
		}
		if (need > 0) {
			fail(ErrorCode.INSUFFICIENT_VOLUME, `not enough volume for ${amount}`);
		}
		return fromInt(total, this._ps);
	}

	/**
	 * Parse a decimal (number or string) into an integer with the given scale.
	 * @param {number|string} value
	 * @param {number} scale
	 * @returns {number}
	 */
	static decimalFrom(value, scale) {
		return toInt(value, scale);
	}

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	/**
	 * Attach a write-ahead log sink, or detach it with null. This also clears
	 * a latched log failure.
	 * @param {?{write: (line: string) => void, sync?: () => void}} sink
	 */
	attachWal(sink) {
		this._wal = sink;
		this._walError = null;
	}

	/**
	 * Return a plain-data image of the whole engine state (internal integers).
	 * @returns {object}
	 */
	dump() {
		const orders = [];
		for (const side of [BUY, SELL]) {
			this.orderBook[side].priceOrdersTreeMap.forEach((node) => {
				for (const o of node.v.toArray()) {
					orders.push(o.toRecord());
				}
			});
		}

		const stops = [];
		for (const book of [this.stopBook._buy, this.stopBook._sell]) {
			book.priceOrdersTreeMap.forEach((node) => {
				for (const o of node.v.toArray()) {
					stops.push(o.toRecord());
				}
			});
		}

		return {
			v: SNAPSHOT_VERSION,
			seq: this._seq,
			tradeId: this._tradeId,
			lsn: this._lsn,
			halted: this._halted,
			lastPrice: this._lastPrice,
			orders,
			stops,
			oco: [...this._oco],
		};
	}

	/**
	 * Restore the state from a dump produced by dump().
	 * Clears the current state first.
	 * @param {object} snapshot
	 */
	restore(snapshot) {
		if (snapshot?.v !== SNAPSHOT_VERSION) {
			fail(ErrorCode.INVALID_SNAPSHOT, "unsupported dump version");
		}

		this.orderBook = new OrderBook(this.symbol);
		this.stopBook = new StopBook(this.symbol);
		this._hidden = { [BUY]: new Map(), [SELL]: new Map() };
		this._trailing = new Map();
		this._nextExpiry = Number.POSITIVE_INFINITY;

		this._seq = snapshot.seq;
		this._tradeId = snapshot.tradeId;
		this._lsn = snapshot.lsn;
		this._halted = snapshot.halted;
		this._lastPrice = snapshot.lastPrice;
		this._oco = new Set(snapshot.oco);

		for (const record of snapshot.orders) {
			const order = Order.fromRecord(this.symbol, record);
			this.orderBook.append(order);
			this.orderBook.volume.increase(order, order.price, order.shown);
			this._addHidden(order, order.hiddenAmount());
			this._track(order);
		}

		const trailing = [];
		for (const record of snapshot.stops) {
			const order = Order.fromRecord(this.symbol, record);
			this.stopBook.append(order);
			this._track(order);
			if (order.type === TRAILING_STOP) {
				trailing.push(order);
			}
		}
		trailing.sort((a, b) => a.seq - b.seq);
		for (const order of trailing) {
			this._trailing.set(order.id, order);
		}
	}

	/**
	 * Apply the records of a write-ahead log after the current state (the
	 * restored snapshot). Records up to the current log position are skipped.
	 * Nothing is written to the log.
	 * @param {object[]} records
	 */
	replay(records) {
		const start = this._lsn;
		let expected = start + 1;
		this._replaying = true;
		try {
			for (const raw of records) {
				const record = checkRecord(raw);
				if (record.lsn <= start) {
					continue;
				}
				if (record.lsn !== expected) {
					fail(
						ErrorCode.WAL_GAP,
						`WAL gap: expected ${expected}, got ${record.lsn}`,
					);
				}
				this._replayRecord(record);
				this._lsn = record.lsn;
				expected++;
			}
		} finally {
			this._replaying = false;
		}
	}

	// -----------------------------------------------------------------------
	// Command plumbing
	// -----------------------------------------------------------------------

	/**
	 * Validate, write to the log, apply. The clock is read once per command, so
	 * the time in the log is the time the command ran with.
	 */
	_run(op, payload, validate, apply) {
		if (this._walError) {
			throw this._walError;
		}
		try {
			validate?.();
			if (this._wal && !this._replaying) {
				this._log(op, payload());
			}
			const before = this._emit ? this._bbo() : null;
			const result = apply();
			if (before) {
				this._emitBbo(before);
			}
			return result;
		} finally {
			this._t = null;
		}
	}

	_log(op, payload) {
		const record = {
			lsn: this._lsn + 1,
			time: this._time(),
			op,
			...payload,
		};
		try {
			this._wal.write(`${JSON.stringify(record)}\n`);
			this._wal.sync?.();
		} catch (error) {
			this._walError = new MatchingoError(
				ErrorCode.WAL_FAILURE,
				`WAL write failed: ${error.message}`,
			);
			throw this._walError;
		}
		this._lsn = record.lsn;
	}

	_replayRecord(record) {
		this._t = record.time;
		try {
			switch (record.op) {
				case "submit":
					this.submit(Order.fromRecord(this.symbol, record.order));
					break;
				case "replace":
					this.replace(record.id, Order.fromRecord(this.symbol, record.order));
					break;
				case "cancel":
					this.cancel(record.id);
					break;
				case "modify":
					this._modify(record.id, record.price, record.amount);
					break;
				case "modifyStop":
					this._modifyStop(record.id, record.stop, record.price, record.amount);
					break;
				case "expire":
					this.expire(record.at);
					break;
				case "halt":
					this.halt();
					break;
				case "resume":
					this.resume();
					break;
			}
		} catch (error) {
			// rejected originally, rejected again
			if (!(error instanceof MatchingoError)) {
				throw error;
			}
		} finally {
			this._t = null;
		}
	}

	_time() {
		if (this._t === null) {
			this._t = this._clock();
		}
		return this._t;
	}

	_expireAt(at) {
		return at === undefined ? this._time() : at;
	}

	_modify(id, price, amount) {
		let order;
		let replacement;
		return this._run(
			"modify",
			() => ({ id, price, amount }),
			() => {
				if (this._halted) {
					fail(ErrorCode.TRADING_HALTED, "trading is halted");
				}
				order = this.orderBook.find(id);
				if (!order) {
					this._notModifiable(id, this.stopBook.find(id));
				}
				replacement = this._copy(order);
				replacement.price = price;
				replacement.amount = amount;
				replacement.open = amount;
				replacement.shown = amount;
				replacement.peak = order.peak && amount > order.peak ? order.peak : 0;
				this._validate(replacement, id);
			},
			() => {
				if (price === order.price && amount <= order.open && !order.peak) {
					const diff = order.open - amount;
					if (diff > 0) {
						order.amount -= diff;
						order.open = amount;
						order.shown = amount;
						this._volumeDown(order, diff);
					}
					return this._amended(order);
				}

				this._removeOrder(order);
				return this._accept(replacement, []);
			},
		);
	}

	_modifyStop(id, stop, price, amount) {
		let order;
		return this._run(
			"modifyStop",
			() => ({ id, stop, price, amount }),
			() => {
				if (this._halted) {
					fail(ErrorCode.TRADING_HALTED, "trading is halted");
				}
				order = this.stopBook.find(id);
				if (!order) {
					this._notModifiable(id, this.orderBook.find(id));
				}
				const replacement = this._copy(order);
				replacement.stop = stop;
				if (order.type === STOP_LIMIT) {
					replacement.price = price;
				}
				replacement.amount = amount;
				replacement.open = amount;
				replacement.shown = amount;
				this._validate(replacement, id);
			},
			() => {
				this.stopBook.remove(order);
				order.stop = stop;
				if (order.type === STOP_LIMIT) {
					order.price = price;
				}
				order.amount = amount;
				order.open = amount;
				order.shown = amount;
				this.stopBook.append(order);
				this._track(order);
				return this._amended(order);
			},
		);
	}

	/**
	 * The result of a modify that left the order in the book.
	 */
	_amended(order) {
		const run = this._runState([]);
		run.stored = true;
		return this._finish(order, run).done;
	}

	_notModifiable(id, wrongKind) {
		if (wrongKind) {
			fail(ErrorCode.WRONG_ORDER_KIND, `wrong order kind for modify: ${id}`);
		}
		fail(ErrorCode.ORDER_NOT_FOUND, `order not found: ${id}`);
	}

	_copy(order) {
		const copy = Order.fromRecord(this.symbol, order.toRecord());
		copy.seq = 0;
		copy.timestamp = 0;
		return copy;
	}

	// -----------------------------------------------------------------------
	// Validation
	// -----------------------------------------------------------------------

	/**
	 * @param {Order} order
	 * @param {string|number} [ignoreId] an ID that is about to be freed
	 */
	_validate(order, ignoreId) {
		if (this._halted) {
			fail(ErrorCode.TRADING_HALTED, "trading is halted");
		}
		if (
			!(order instanceof Order) ||
			order.symbol !== this.symbol ||
			!TYPES.has(order.type) ||
			order.seq !== 0 ||
			order.open !== order.amount
		) {
			fail(ErrorCode.INVALID_ORDER, "invalid order");
		}
		if (order.side !== BUY && order.side !== SELL) {
			fail(ErrorCode.INVALID_SIDE, `invalid side: ${order.side}`);
		}
		if (order.canceled) {
			fail(ErrorCode.ALREADY_CANCELED, `order is canceled: ${order.id}`);
		}
		if (!Number.isSafeInteger(order.amount) || order.amount <= 0) {
			fail(ErrorCode.INVALID_QUANTITY, `invalid quantity: ${order.amount}`);
		}
		if (
			order.peak &&
			(order.type !== LIMIT || order.peak < 0 || order.peak >= order.amount)
		) {
			fail(ErrorCode.INVALID_QUANTITY, `invalid peak: ${order.peak}`);
		}
		if (order.type === TRAILING_STOP) {
			const offset = order.trailOffset > 0;
			const percent = order.trailPercent > 0 && order.trailPercent < 100;
			if (offset === percent) {
				fail(ErrorCode.INVALID_PRICE, "invalid trailing stop distance");
			}
		}
		this._checkInstrument(order);
		this._checkSTP(order);
		this._checkTIF(order);
		if (this._find(order.id) && order.id !== ignoreId) {
			fail(ErrorCode.DUPLICATE_ORDER_ID, `order id is in use: ${order.id}`);
		}
	}

	_checkInstrument(order) {
		const ins = this._ins;
		const prices = [];
		if (order.type === LIMIT || order.type === STOP_LIMIT) {
			prices.push(order.price);
		}
		if (order.isStop()) {
			prices.push(order.stop);
		}
		for (const price of prices) {
			if (!Number.isSafeInteger(price) || price <= 0) {
				fail(ErrorCode.INVALID_PRICE, `invalid price: ${price}`);
			}
			if (ins.tickSize && price % ins.tickSize !== 0) {
				fail(ErrorCode.TICK_SIZE, `price is not a multiple of tickSize`);
			}
			if (
				(ins.minPrice && price < ins.minPrice) ||
				(ins.maxPrice && price > ins.maxPrice)
			) {
				fail(ErrorCode.PRICE_BAND, "price is outside of the price band");
			}
		}

		if (order.quote) {
			return;
		}
		if (
			ins.lotSize &&
			(order.amount % ins.lotSize !== 0 ||
				order.peak % ins.lotSize !== 0 ||
				(order.amount - order.peak) % ins.lotSize !== 0)
		) {
			fail(ErrorCode.LOT_SIZE, "amount is not a multiple of lotSize");
		}
		if (
			(ins.minQuantity && order.amount < ins.minQuantity) ||
			(ins.maxQuantity && order.amount > ins.maxQuantity)
		) {
			fail(ErrorCode.QUANTITY_RANGE, "amount is outside of the quantity range");
		}
	}

	_checkSTP(order) {
		if (!STPS.has(order.stp)) {
			fail(ErrorCode.INVALID_STP, `invalid stp mode: ${order.stp}`);
		}
		if (order.stp === STP_NONE) {
			return;
		}
		if (order.traderID === null || order.traderID === undefined) {
			fail(ErrorCode.INVALID_STP, "stp needs a traderID");
		}
		if (order.tif === FOK) {
			fail(ErrorCode.INVALID_STP, "FOK can not be combined with stp");
		}
	}

	_checkTIF(order) {
		const { tif, expiry, ttl } = order;
		if (!TIFS.has(tif)) {
			fail(ErrorCode.INVALID_TIF, `invalid time in force: ${tif}`);
		}
		if (order.isMarket() && (tif === GTD || expiry !== 0 || ttl !== 0)) {
			fail(ErrorCode.INVALID_TIF, "market orders do not expire");
		}
		if (ttl !== 0 && (!Number.isSafeInteger(ttl) || ttl < 0 || tif !== GTC)) {
			fail(ErrorCode.INVALID_TIF, "ttl works only with GTC");
		}
		if (expiry !== 0 && (!Number.isSafeInteger(expiry) || expiry < 0)) {
			fail(ErrorCode.INVALID_TIF, `invalid expiry: ${expiry}`);
		}
		if (expiry !== 0 && tif !== GTD) {
			fail(ErrorCode.INVALID_TIF, "expiry works only with GTD");
		}
		if (tif === GTD && expiry === 0) {
			fail(ErrorCode.INVALID_TIF, "GTD needs an expiry");
		}
		if (expiry !== 0 && expiry <= this._time()) {
			fail(ErrorCode.ORDER_EXPIRED, `order is already expired: ${order.id}`);
		}
	}

	// -----------------------------------------------------------------------
	// Order processing
	// -----------------------------------------------------------------------

	/**
	 * @param {Order} order
	 * @param {Array<string|number>} canceled
	 * @returns {Done}
	 */
	_accept(order, canceled) {
		if (this._nextExpiry !== Number.POSITIVE_INFINITY) {
			canceled.push(...this._purgeExpired(this._time()));
		}
		if (order.ttl) {
			order.expiry = this._time() + order.ttl;
			order.tif = GTD;
			order.ttl = 0;
		}
		if (!order.timestamp) {
			order.timestamp = this._time();
		}
		order.seq = ++this._seq;

		const root = this._process(order, canceled);

		// Activated stops are new orders. They start after the order that
		// fired them is complete, in the order of activation.
		const queue = root.activated.map((stop) => [stop, root.done]);
		for (let i = 0; i < queue.length; i++) {
			const [stop, parent] = queue[i];
			const result = this._process(stop, []);
			parent.activations.push(result.done);
			for (const next of result.activated) {
				queue.push([next, result.done]);
			}
		}

		return root.done;
	}

	_runState(canceled) {
		return {
			canceled,
			fills: [],
			activated: [],
			processed: 0,
			stored: false,
			stopped: false,
			decremented: false,
			lastPrice: 0,
		};
	}

	/**
	 * @param {Order} order
	 * @param {Array<string|number>} canceled
	 * @returns {{done: Done, activated: Order[]}}
	 */
	_process(order, canceled) {
		const run = this._runState(canceled);

		// the partner of an OCO order that is complete: it never starts
		if (this._oco.delete(order.id)) {
			this._markCanceled(order, run.canceled);
			return this._finish(order, run);
		}

		if (order.isStop()) {
			this.stopBook.append(order);
			if (order.type === TRAILING_STOP) {
				this._trailing.set(order.id, order);
			}
			this._track(order);
			run.stored = true;
			return this._finish(order, run);
		}

		if (order.isMarket() && !order.toLimit) {
			order.tif = IOC;
		}

		if (
			(order.tif === FOK && !this._canFill(order)) ||
			(order.postOnly && this._wouldCross(order))
		) {
			this._markCanceled(order, run.canceled);
			return this._finish(order, run);
		}

		const wasMarket = order.isMarket();
		this._match(order, run);
		this._settle(order, run);

		if (run.processed > 0 && (order.open === 0 || (wasMarket && !run.stored))) {
			this._cancelPartner(order, run);
		}

		return this._finish(order, run);
	}

	/**
	 * Decide the fate of the unmatched part of the order.
	 */
	_settle(order, run) {
		if (order.open === 0) {
			if (run.decremented && run.processed < order.amount) {
				this._markCanceled(order, run.canceled);
			}
			return;
		}

		const resting =
			!run.stopped &&
			order.tif !== IOC &&
			order.tif !== FOK &&
			(order.isLimit() || (order.toLimit && run.processed > 0));

		if (!resting) {
			this._markCanceled(order, run.canceled);
			return;
		}

		if (order.isMarket()) {
			order.type = LIMIT;
			order.price = run.lastPrice;
			order.toLimit = false;
		}
		this._rest(order);
		run.stored = true;
	}

	/**
	 * @param {Order} order
	 * @param {object} run
	 */
	_match(order, run) {
		const book = this.orderBook[order.opposite];
		const limit = order.isLimit() ? order.price : 0;

		while (order.open > 0 && !run.stopped) {
			const level = book.priceOrdersTreeMap.first();
			if (!level) {
				break;
			}
			const price = level.k;
			if (limit && (order.side === BUY ? price > limit : price < limit)) {
				break;
			}

			const queue = level.v;
			let traded = false;

			while (queue.length > 0 && order.open > 0 && !run.stopped) {
				const maker = queue.peekFront();

				if (
					order.stp !== STP_NONE &&
					order.traderID !== null &&
					order.traderID === maker.traderID
				) {
					this._selfTrade(order, maker, run);
					continue;
				}

				let amount = Math.min(order.open, maker.shown);
				let spent = amount;
				if (order.quote) {
					amount = Math.min(
						baseOf(order.open, price, this._quoteDivisor),
						maker.shown,
					);
					if (amount === 0) {
						// dust: the budget can not buy a unit
						run.stopped = true;
						break;
					}
					spent = quoteOf(amount, price, this._quoteDivisor);
				}

				order.open -= spent;
				run.processed += spent;
				run.lastPrice = price;
				traded = true;
				this._fill(order, maker, price, amount, run);
			}

			if (traded) {
				this._afterLevel(price, run);
			}
		}
	}

	/**
	 * The incoming order meets a resting order of the same trader.
	 */
	_selfTrade(order, maker, run) {
		let mode = order.stp;
		if (mode === STP_DECREMENT && order.quote) {
			mode = STP_CANCEL_NEWEST;
		}

		switch (mode) {
			case STP_CANCEL_NEWEST:
				run.stopped = true;
				return;
			case STP_CANCEL_BOTH:
				run.stopped = true;
				this._cancelMaker(maker, run);
				return;
			case STP_CANCEL_OLDEST:
				this._cancelMaker(maker, run);
				return;
			case STP_DECREMENT: {
				const overlap = Math.min(order.open, maker.shown);
				order.open -= overlap;
				run.decremented = true;
				maker.open -= overlap;
				maker.shown -= overlap;
				this._volumeDown(maker, overlap);
				if (maker.shown > 0) {
					return;
				}
				if (maker.open > 0) {
					this._refill(maker);
				} else {
					this._cancelMaker(maker, run);
				}
			}
		}
	}

	/**
	 * Cancel the resting order at the front of the best level.
	 */
	_cancelMaker(maker, run) {
		this._unrest(maker, true);
		this._markCanceled(maker, run.canceled);
	}

	/**
	 * One fill: the taker takes `amount` from the maker at the maker's price.
	 */
	_fill(taker, maker, price, amount, run) {
		const tradeId = ++this._tradeId;
		maker.open -= amount;
		maker.shown -= amount;

		run.fills.push({ tradeId, id: maker.id, price, amount });
		this._emit &&
			this._ev("trade", {
				tradeId,
				makerId: maker.id,
				takerId: taker.id,
				price: fromInt(price, this._ps),
				amount: fromInt(amount, this._as),
			});
		this._volumeDown(maker, amount);

		if (maker.shown > 0) {
			return;
		}
		if (maker.open > 0) {
			this._refill(maker);
			return;
		}
		this._unrest(maker, true);
		this._cancelPartner(maker, run);
	}

	/**
	 * Iceberg: post the next slice at the back of the level.
	 */
	_refill(maker) {
		const next = Math.min(maker.peak, maker.open);
		maker.shown = next;
		this._addHidden(maker, -next);
		this.orderBook.requeueFront(maker);
		this._volumeUp(maker, next);
	}

	/**
	 * Run after a price level has traded: circuit breaker, trailing stops,
	 * stop activation.
	 */
	_afterLevel(price, run) {
		const last = this._lastPrice;
		if (
			this._breaker &&
			last !== 0 &&
			Math.abs(price - last) * 100 > last * this._breaker
		) {
			this._setHalted(true, true);
		}
		this._lastPrice = price;

		this._trail(price);

		if (this.stopBook.isEmpty()) {
			return;
		}
		for (const stop of this.stopBook.activate(price)) {
			this._trailing.delete(stop.id);
			if (stop.type === STOP_LIMIT) {
				stop.type = LIMIT;
			} else {
				stop.type = MARKET;
				stop.price = 0;
			}
			run.activated.push(stop);
			this._emit && this._ev("activated", { id: stop.id });
		}
	}

	/**
	 * Move the trailing stops that follow the trade price.
	 */
	_trail(price) {
		for (const order of this._trailing.values()) {
			const offset = order.trailPercent
				? Math.max(1, Math.round((price * order.trailPercent) / 100))
				: order.trailOffset;
			const candidate = order.side === SELL ? price - offset : price + offset;
			if (
				order.side === SELL ? candidate > order.stop : candidate < order.stop
			) {
				this.stopBook.remove(order);
				order.stop = candidate;
				this.stopBook.append(order);
			}
		}
	}

	/**
	 * The order is complete: cancel its OCO partner, or remember to cancel it
	 * when it arrives.
	 */
	_cancelPartner(order, run) {
		const id = order.oco;
		if (id === null || id === undefined) {
			return;
		}
		const partner = this._find(id);
		if (!partner) {
			this._oco.add(id);
			return;
		}
		this._removeOrder(partner);
		this._markCanceled(partner, run.canceled);
	}

	/**
	 * @param {Order} order
	 * @param {object} run
	 * @returns {{done: Done, activated: Order[]}}
	 */
	_finish(order, run) {
		const scale = order.quote ? this._ps : this._as;
		const done = new Done(this._publicOrder(order), order.seq);

		done.quantity = fromInt(order.amount, scale);
		done.processed = fromInt(run.processed, scale);
		done.left = fromInt(order.amount - run.processed, scale);
		done.stored = run.stored;
		done.canceled = run.canceled;
		done.activated = run.activated.map((stop) => stop.id);

		if (run.fills.length > 0) {
			done.trades.push({
				id: order.id,
				price: fromInt(order.price, this._ps),
				isQuote: order.quote,
				amount: done.processed,
				role: TAKER,
			});
			for (const fill of run.fills) {
				done.trades.push({
					tradeId: fill.tradeId,
					id: fill.id,
					price: fromInt(fill.price, this._ps),
					isQuote: false,
					amount: fromInt(fill.amount, this._as),
					role: MAKER,
				});
			}
		}

		return { done, activated: run.activated };
	}

	// -----------------------------------------------------------------------
	// Book bookkeeping
	// -----------------------------------------------------------------------

	_find(id) {
		return this.orderBook.find(id) || this.stopBook.find(id) || null;
	}

	/**
	 * Put a limit order at the back of its price level.
	 */
	_rest(order) {
		order.shown = order.peak ? Math.min(order.peak, order.open) : order.open;
		this._addHidden(order, order.hiddenAmount());
		this.orderBook.append(order);
		this._volumeUp(order, order.shown);
		this._track(order);
	}

	/**
	 * Take a limit order out of its level.
	 * @param {Order} order
	 * @param {boolean} front it is the first order of the best level
	 */
	_unrest(order, front) {
		this._addHidden(order, -order.hiddenAmount());
		if (front) {
			this.orderBook.fastRemove(order);
		} else {
			this.orderBook.remove(order);
		}
		if (order.shown > 0) {
			this._volumeDown(order, order.shown);
		}
	}

	/**
	 * Take a resting or dormant order out of the books.
	 */
	_removeOrder(order) {
		if (order.isStop()) {
			this.stopBook.remove(order);
			this._trailing.delete(order.id);
		} else {
			this._unrest(order, false);
		}
	}

	_markCanceled(order, canceled) {
		order.canceled = true;
		canceled.push(order.id);
		this._emit && this._ev("canceled", { id: order.id });
	}

	_addHidden(order, amount) {
		if (amount === 0) {
			return;
		}
		const hidden = this._hidden[order.side];
		const sum = (hidden.get(order.price) || 0) + amount;
		if (sum === 0) {
			hidden.delete(order.price);
		} else {
			hidden.set(order.price, sum);
		}
	}

	_volumeUp(order, amount) {
		this.orderBook.volume.increase(order, order.price, amount);
		this._emitVolume(order);
	}

	_volumeDown(order, amount) {
		this.orderBook.volume.decrease(order, order.price, amount);
		this._emitVolume(order);
	}

	_emitVolume(order) {
		this._emit &&
			this._ev("volume", {
				side: order.side,
				price: fromInt(order.price, this._ps),
				volume: fromInt(this.orderBook.volume.getVolume(order), this._as),
			});
	}

	/**
	 * Is the whole order fillable at prices within its limit? Hidden parts of
	 * iceberg orders count.
	 */
	_canFill(order) {
		const volume = this.orderBook.volume[order.opposite];
		const hidden = this._hidden[order.opposite];
		const limit = order.price;
		const levels = volume.geyKeys().iterator();
		let sum = 0;
		for (let next = levels.next(); !next.done; next = levels.next()) {
			const price = next.value.k;
			if (limit && (order.side === BUY ? price > limit : price < limit)) {
				break;
			}
			sum += volume.getRaw()[price] + (hidden.get(price) || 0);
			if (sum >= order.open) {
				return true;
			}
		}
		return false;
	}

	_wouldCross(order) {
		const best = this.orderBook.volume.best(order.opposite);
		if (!best) {
			return false;
		}
		return order.side === BUY
			? best.price <= order.price
			: best.price >= order.price;
	}

	_best(side) {
		const entry = this.orderBook.volume.best(side);
		if (!entry) return null;
		return {
			price: fromInt(entry.price, this._ps),
			amount: fromInt(entry.amount, this._as),
		};
	}

	_bbo() {
		return { bid: this._best(BUY), ask: this._best(SELL) };
	}

	_emitBbo(before) {
		const after = this._bbo();
		const same = (a, b) =>
			a === b || (a && b && a.price === b.price && a.amount === b.amount);
		if (!same(before.bid, after.bid) || !same(before.ask, after.ask)) {
			this._ev("bbo", after);
		}
	}

	_setHalted(halted, circuitBreaker) {
		if (this._halted === halted) {
			return;
		}
		this._halted = halted;
		this._ev("halt", { halted, circuitBreaker });
	}

	_ev(name, data) {
		this._emit && this.emitter[name]({ ...data, sequence: this._seq });
	}

	// -----------------------------------------------------------------------
	// Expiry
	// -----------------------------------------------------------------------

	/**
	 * Remember the earliest expiry of the book.
	 */
	_track(order) {
		if (order.expiry && order.expiry < this._nextExpiry) {
			this._nextExpiry = order.expiry;
		}
	}

	/**
	 * Cancel the orders that expire at or before `now`: by expiry, then by ID.
	 * @param {number} now
	 * @returns {Array<string|number>} the canceled IDs
	 */
	_purgeExpired(now) {
		const canceled = [];
		if (this._nextExpiry > now) {
			return canceled;
		}

		const orders = [
			...Object.values(this.orderBook[BUY].unique),
			...Object.values(this.orderBook[SELL].unique),
			...Object.values(this.stopBook._buy.unique),
			...Object.values(this.stopBook._sell.unique),
		].filter((order) => order.expiry !== 0);

		const due = orders
			.filter((order) => order.expiry <= now)
			.sort((a, b) => a.expiry - b.expiry || compareIds(a.id, b.id));
		for (const order of due) {
			this._removeOrder(order);
			this._markCanceled(order, canceled);
		}

		this._nextExpiry = Math.min(
			Number.POSITIVE_INFINITY,
			...orders.filter((order) => order.expiry > now).map((o) => o.expiry),
		);
		return canceled;
	}

	// -----------------------------------------------------------------------
	// Numbers
	// -----------------------------------------------------------------------

	_instrument(definition) {
		const parse = (name, scale) => {
			const value = definition[name];
			if (value === undefined || value === null) {
				return 0;
			}
			try {
				return toInt(value, scale);
			} catch (error) {
				fail(ErrorCode.INVALID_INSTRUMENT, `${name}: ${error.message}`);
			}
		};
		const ins = {
			tickSize: parse("tickSize", this._ps),
			lotSize: parse("lotSize", this._as),
			minQuantity: parse("minQuantity", this._as),
			maxQuantity: parse("maxQuantity", this._as),
			minPrice: parse("minPrice", this._ps),
			maxPrice: parse("maxPrice", this._ps),
		};
		if (
			(ins.maxQuantity && ins.minQuantity > ins.maxQuantity) ||
			(ins.maxPrice && ins.minPrice > ins.maxPrice)
		) {
			fail(ErrorCode.INVALID_INSTRUMENT, "min is greater than max");
		}
		return ins;
	}

	/**
	 * @param {number|string} value
	 * @param {number} scale
	 * @param {string} precisionCode
	 * @param {string} invalidCode
	 * @returns {number} a positive scaled integer
	 */
	_positive(value, scale, precisionCode, invalidCode) {
		let int;
		try {
			int = toInt(value, scale);
		} catch (error) {
			fail(
				/too many digits/.test(error.message) ? precisionCode : invalidCode,
				error.message,
			);
		}
		if (int === 0) {
			fail(invalidCode, `value must be greater than zero: ${value}`);
		}
		return int;
	}

	_price(value) {
		return this._positive(
			value,
			this._ps,
			ErrorCode.PRICE_PRECISION,
			ErrorCode.INVALID_PRICE,
		);
	}

	_stop(value) {
		return this._price(value);
	}

	_amount(value) {
		return this._positive(
			value,
			this._as,
			ErrorCode.QUANTITY_PRECISION,
			ErrorCode.INVALID_QUANTITY,
		);
	}

	_quoteOrder(id, side, value) {
		const amount = this._positive(
			value,
			this._ps,
			ErrorCode.QUANTITY_PRECISION,
			ErrorCode.INVALID_QUANTITY,
		);
		if (!Number.isSafeInteger(amount * this._quoteDivisor)) {
			fail(ErrorCode.INVALID_QUANTITY, `quote amount is too big: ${value}`);
		}
		const order = createMarketOrder(this.symbol, id, side, amount);
		order.quote = true;
		return order;
	}

	_priceAmount(price, amount) {
		const p = this._price(price);
		const a = this._amount(amount);
		if (!Number.isSafeInteger(p * a)) {
			fail(
				ErrorCode.INVALID_ORDER,
				`price * amount is too big: ${price} * ${amount}`,
			);
		}
		return [p, a];
	}

	/**
	 * A copy of the order with decimals instead of scaled integers.
	 */
	_publicOrder(order) {
		const scale = order.quote ? this._ps : this._as;
		return {
			id: order.id,
			symbol: order.symbol,
			type: order.type,
			side: order.side,
			price: fromInt(order.price, this._ps),
			stop: fromInt(order.stop, this._ps),
			amount: fromInt(order.amount, scale),
			open: fromInt(order.open, scale),
			shown: fromInt(Math.min(order.shown, order.open), scale),
			peak: fromInt(order.peak, this._as),
			tif: order.tif,
			expiry: order.expiry,
			oco: order.oco,
			traderID: order.traderID,
			stp: order.stp,
			postOnly: order.postOnly,
			isQuote: order.quote,
			trailOffset: fromInt(order.trailOffset, this._ps),
			trailPercent: order.trailPercent,
			timestamp: order.timestamp,
			seq: order.seq,
			canceled: order.canceled,
		};
	}
}

Matchingo.SELL = SELL;
Matchingo.BUY = BUY;

Matchingo.MARKET = MARKET;
Matchingo.LIMIT = LIMIT;
Matchingo.STOP_LIMIT = STOP_LIMIT;
Matchingo.STOP_MARKET = STOP_MARKET;
Matchingo.TRAILING_STOP = TRAILING_STOP;

Matchingo.GTC = GTC;
Matchingo.GTD = GTD;
Matchingo.IOC = IOC;
Matchingo.FOK = FOK;

Matchingo.STP_NONE = STP_NONE;
Matchingo.STP_CANCEL_NEWEST = STP_CANCEL_NEWEST;
Matchingo.STP_CANCEL_OLDEST = STP_CANCEL_OLDEST;
Matchingo.STP_CANCEL_BOTH = STP_CANCEL_BOTH;
Matchingo.STP_DECREMENT = STP_DECREMENT;
