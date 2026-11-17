import {
	BUY,
	FOK,
	GTC,
	IOC,
	LIMIT,
	MARKET,
	SELL,
	STOP_LIMIT,
} from "./constants.js";
import { baseOf, checkScale, fromInt, quoteOf, toInt } from "./decimal.js";
import Emitter from "./emmiter.js";
import Done from "./models/done.js";
import Order from "./models/order.js";
import StopLimitOrder from "./models/stop-limit-order.js";
import Trade from "./models/trade.js";
import {
	createLimitOrder,
	createMarketOrder,
	createStopLimitOrder,
} from "./new-order.js";
import OrderBook from "./order-book.js";
import OrdersCollection from "./orders-collection.js";
import StopBook from "./stop-book.js";

/**
 * @typedef {1|2} Side
 */

/**
 * @param {string} symbol
 * @param {boolean} emit
 * @param {{priceScale: number, amountScale: number}} scales digits after the point
 */
export default class Matchingo {
	constructor(
		symbol,
		{ priceScale, amountScale, tickSize, lotSize, emitter } = {},
	) {
		if (!symbol) {
			throw new Error("please set up symbol");
		}
		checkScale("priceScale", priceScale);
		checkScale("amountScale", amountScale);

		this._ps = priceScale;
		this._as = amountScale;
		this._quoteDivisor = 10 ** amountScale;

		this._tick = tickSize !== undefined ? toInt(tickSize, priceScale) : 1;
		this._lot = lotSize !== undefined ? toInt(lotSize, amountScale) : 1;
		if (this._tick < 1) throw new Error("tickSize must be >= 1 unit");
		if (this._lot < 1) throw new Error("lotSize must be >= 1 unit");

		this.symbol = symbol;
		this.orderBook = new OrderBook(this.symbol);
		this.stopBook = new StopBook(this.symbol);

		this._orders = new OrdersCollection();
		this._activated = new OrdersCollection();
		this._canceled = new OrdersCollection();
		this._oco = new OrdersCollection();

		this._seq = 0;

		this._emit = emitter || false;
		this.emitter = new Emitter(this.symbol);
	}

	/**
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number} baseAmount
	 * @returns {Order}
	 */
	newMarketOrder(id, side, baseAmount) {
		const a = this._positive(baseAmount, this._as);
		this._checkLot(a, baseAmount);
		return createMarketOrder(this.symbol, id, side, a);
	}

	/**
	 * @param {string|number} id
	 * @param {number} quoteAmount
	 * @returns {Order}
	 */
	newMarketBuyQuoteOrder(id, quoteAmount) {
		const order = createMarketOrder(
			this.symbol,
			id,
			BUY,
			this._quote(quoteAmount),
		);
		order.setQuoteMode();
		return order;
	}

	/**
	 * @param {string|number} id
	 * @param {number} quoteAmount
	 * @returns {Order}
	 */
	newMarketSellQuoteOrder(id, quoteAmount) {
		const order = createMarketOrder(
			this.symbol,
			id,
			SELL,
			this._quote(quoteAmount),
		);
		order.setQuoteMode();
		return order;
	}

	/**
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number} price
	 * @param {number} amount
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
	 * @param {number} price
	 * @param {number} amount
	 * @returns {Order}
	 */
	newPostOnlyLimitOrder(id, side, price, amount) {
		const [p, a] = this._priceAmount(price, amount);
		const order = createLimitOrder(this.symbol, id, side, p, a);
		order.postOnly = true;
		return order;
	}

	/**
	 * Iceberg limit order: only peakAmount is visible at a time.
	 * When the peak is consumed, the order refills from its hidden reserve.
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number} price
	 * @param {number} amount total quantity (visible + hidden)
	 * @param {number} peakAmount visible quantity per slice
	 * @returns {Order}
	 */
	newIcebergOrder(id, side, price, amount, peakAmount) {
		const [p, a] = this._priceAmount(price, amount);
		const peak = this._positive(peakAmount, this._as);
		if (peak % this._lot !== 0) {
			throw new Error(
				`peakAmount must be a multiple of lotSize: ${peakAmount}`,
			);
		}
		if (peak >= a) {
			throw new Error(
				`peakAmount must be less than amount: ${peakAmount} >= ${amount}`,
			);
		}
		const order = createLimitOrder(this.symbol, id, side, p, a);
		order.peakAmount = peak;
		order.open_amount = peak;
		return order;
	}

	/**
	 * @param {string|number} id
	 * @param {Side} side
	 * @param {number} stop
	 * @param {number} price
	 * @param {number} amount
	 * @returns {StopLimitOrder}
	 */
	newStopLimitOrder(id, side, stop, price, amount) {
		const [p, a] = this._priceAmount(price, amount);
		const s = this._positive(stop, this._ps);
		if (s % this._tick !== 0) {
			throw new Error(`stop must be a multiple of tickSize: ${stop}`);
		}
		return createStopLimitOrder(this.symbol, id, side, s, p, a);
	}

	/**
	 * @param {Order} order
	 */
	add(order) {
		this._checkSymbol(order);

		if (order.type === LIMIT) {
			this.orderBook.append(order) && this._increaseVolume(order);
			return;
		}

		if (order.type === STOP_LIMIT) {
			this.stopBook.append(order);
		}
	}

	/**
	 * @param {string|number} id
	 * @returns {boolean}
	 */
	cancel(id) {
		const order = this.orderBook.find(id) || this.stopBook.find(id);

		if (!order) {
			return false;
		}

		if (order.type === LIMIT) {
			this.orderBook.remove(order);
			this._decreaseVolume(order, order.open_amount);
			return true;
		}

		if (order.type === STOP_LIMIT) {
			this.stopBook.remove(order);
			return true;
		}

		return false;
	}

	/**
	 * @param {Order} order
	 */
	process(order) {
		if (!order) {
			return;
		}

		if (this.order(order.id)) {
			return false;
		}

		order.seq = ++this._seq;
		order.timestamp = Date.now();

		const done = this._process(order);
		if (!(done instanceof Done)) {
			return done;
		}

		// An activated stop order is a new order. It starts after the order
		// that fired it is complete, and it has its own result.
		const queue = this._activated.toArray();
		for (let i = 0; i < queue.length; i++) {
			queue[i].setTaker();
			done.activations.push(this._process(queue[i]));
			queue.push(...this._activated.toArray());
		}

		return done;
	}

	/**
	 * @param {Order} order
	 * @returns {Done|boolean}
	 */
	_process(order) {
		this._reset();

		if (this._checkCancelOCO(order)) {
			this._cancelOrder(order);
			this._processCanceled();
			return this._matchingOrderResult(order);
		}

		if (order.type === STOP_LIMIT) {
			this.add(order);
			return true;
		}

		if (order.type === MARKET) {
			order.tif = IOC;
		}

		if (order.type === LIMIT) {
			if (
				FOK === order.tif &&
				!this.orderBook.volume.hasEnough(
					order.oppositeSide(),
					order.price,
					order.amount,
				)
			) {
				this._cancelOrder(order);
				this._processCanceled();
				return this._matchingOrderResult(order);
			}

			if (order.postOnly && this._wouldMatchImmediately(order)) {
				this._cancelOrder(order);
				this._processCanceled();
				return this._matchingOrderResult(order);
			}
		}

		this._matchOrders(order);

		const trade = new Trade(order, [], this._quoteDivisor);

		if (this._orders.size()) {
			this._orders.orders.forEach((order) => {
				this._decreaseVolume(order, order.tradeAmount);
			});
			trade.setOrders(this._orders.toArray());
		}

		if (order.tif === IOC) {
			if (order._isQuote && trade.left > 0) {
				this._cancelOrder(order);
			}

			if (!order._isQuote && order.open_amount > 0) {
				this._cancelOrder(order);
			}
		}

		this._canceled.size() && this._processCanceled();

		if (order.type === LIMIT && !order.canceled && order.open_amount > 0) {
			this.add(order);
		}

		return this._matchingOrderResult(order, trade);
	}

	/**
	 * Modify a resting limit order.
	 *
	 * Same price and amount decreases: updates in place, keeps time priority.
	 * Price changes or amount increases: cancels and re-processes (loses time priority).
	 *
	 * @param {string|number} id
	 * @param {number} newPrice
	 * @param {number} newAmount
	 * @returns {Done|boolean} Done for re-queue, true for in-place, false if not found
	 */
	modify(id, newPrice, newAmount) {
		const order = this.orderBook.find(id);
		if (!order) {
			return false;
		}

		const [p, a] = this._priceAmount(newPrice, newAmount);

		if (p === order.price && a <= order.open_amount) {
			// In-place: reduce open_amount, keep queue position
			const diff = order.open_amount - a;
			order.amount -= diff;
			order.open_amount = a;
			if (diff > 0) {
				this.orderBook.volume.decrease(order, order.price, diff);
				this._emitVolume(order);
			}
			return true;
		}

		// Re-queue: cancel old, create new (loses time priority)
		const { side, tif, oco } = order;
		this.cancel(id);

		const newOrder = createLimitOrder(this.symbol, id, side, p, a);
		newOrder.tif = tif;
		newOrder.oco = oco;

		return this.process(newOrder);
	}

	/**
	 * @param {string|number} id
	 * @returns {?Order}
	 */
	order(id) {
		return this.orderBook.find(id) || this.stopBook.find(id);
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
		this._emit && this.emitter.depth({ depth });
		return depth;
	}

	bestBid() {
		const entry = this.orderBook.volume.best(BUY);
		if (!entry) return null;
		return {
			price: fromInt(entry.price, this._ps),
			amount: fromInt(entry.amount, this._as),
		};
	}

	bestAsk() {
		const entry = this.orderBook.volume.best(SELL);
		if (!entry) return null;
		return {
			price: fromInt(entry.price, this._ps),
			amount: fromInt(entry.amount, this._as),
		};
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
	 * Parse a decimal (number or string) into an integer with the given scale.
	 * @param {number|string} value
	 * @param {number} scale
	 * @returns {number}
	 */
	static decimalFrom(value, scale) {
		return toInt(value, scale);
	}

	/**
	 * Return a compact snapshot of all resting orders (internal integers).
	 * @returns {{ v: number, seq: number, l: Array, s: Array }}
	 */
	dump() {
		const l = [];
		for (const side of [BUY, SELL]) {
			this.orderBook[side].priceOrdersTreeMap.forEach((node) => {
				node.v.toArray().forEach((o) => {
					l.push([
						o.id,
						o.side,
						o.price,
						o.amount,
						o.open_amount,
						o.tif,
						o.oco,
						o.postOnly || false,
						o.peakAmount || 0,
					]);
				});
			});
		}

		const s = [];
		for (const book of [this.stopBook._buy, this.stopBook._sell]) {
			book.priceOrdersTreeMap.forEach((node) => {
				node.v.toArray().forEach((o) => {
					s.push([o.id, o.side, o.stop, o.price, o.amount, o.tif, o.oco]);
				});
			});
		}

		return { v: 1, seq: this._seq, l, s };
	}

	/**
	 * Restore state from a dump produced by dump().
	 * Clears the current books first.
	 * @param {{ v: number, seq: number, l: Array, s: Array }} snapshot
	 */
	restore(snapshot) {
		if (snapshot?.v !== 1) {
			throw new Error("unsupported dump version");
		}

		this.orderBook = new OrderBook(this.symbol);
		this.stopBook = new StopBook(this.symbol);
		this._seq = snapshot.seq;

		for (const [
			id,
			side,
			price,
			amount,
			open_amount,
			tif,
			oco,
			postOnly,
			peakAmount,
		] of snapshot.l) {
			const o = new Order(this.symbol, id, LIMIT, side, price, amount);
			o.open_amount = open_amount;
			o.tif = tif ?? GTC;
			o.oco = oco ?? null;
			o.postOnly = postOnly ?? false;
			o.peakAmount = peakAmount ?? 0;
			this.orderBook.append(o);
			this.orderBook.volume.increase(o, price, open_amount);
		}

		for (const [id, side, stop, price, amount, tif, oco] of snapshot.s) {
			const o = new StopLimitOrder(this.symbol, id, side, stop, price, amount);
			o.tif = tif ?? GTC;
			o.oco = oco ?? null;
			this.stopBook.append(o);
		}
	}

	// -----------------------------------------------------------------------

	/**
	 * Fire the stop orders that the trade price crosses. The engine starts
	 * them after the current order is complete.
	 * @param {number} tradePrice
	 */
	_activateStops(tradePrice) {
		if (this.stopBook.isEmpty()) {
			return;
		}
		this.stopBook.activate(tradePrice).forEach((stop) => {
			this._activated.append(stop);
		});
	}

	/**
	 * @param {Order} order
	 */
	_matchOrders(order) {
		if (order.role === 80) {
			throw Error("Order with MAKER role as order argument for matchOrders");
		}

		let amount = order.open_amount;
		if (!amount) {
			return;
		}

		const iter = this.orderBook.getBestIterator(order);
		while (amount > 0 && iter.value) {
			amount = this._processQueue(iter.value, order, amount);
			iter.next();
		}
	}

	_processQueue(queue, order, amount) {
		while (queue.length) {
			if (order.open_amount === 0) {
				break;
			}

			const limitOrder = queue.peekFront();

			if (this._checkCancelOCO(limitOrder)) {
				this._cancelOrder(limitOrder);
				continue;
			}

			if (order.traderID !== null && order.traderID === limitOrder.traderID) {
				this._cancelOrder(limitOrder);
				continue;
			}

			const tradePrice = this.orderBook.comparator.compare(order, limitOrder);
			if (!tradePrice) {
				amount = 0;
				break;
			}

			let tradeAmount = 0;
			let spent = 0;

			if (order._isQuote) {
				tradeAmount = limitOrder.getMaxAmount(
					baseOf(amount, tradePrice, this._quoteDivisor),
				);
				spent = quoteOf(tradeAmount, tradePrice, this._quoteDivisor);
			} else {
				tradeAmount = limitOrder.getMaxAmount(amount);
				spent = tradeAmount;
			}

			if (tradeAmount === 0) {
				break;
			}

			amount -= spent;

			const removed = this._increase(
				order,
				limitOrder,
				tradePrice,
				tradeAmount,
				spent,
			);

			this._activateStops(tradePrice);

			if (removed) {
				continue;
			}

			if (order.open_amount === 0) {
				break;
			}
		}

		return amount;
	}

	_increase(order, orderBookOrder, tradePrice, tradeAmount, spent) {
		if (tradeAmount === 0) {
			throw new Error("increase method received zero amount!");
		}

		order.increase(spent, tradePrice);

		this._cancelOCO(order);

		if (orderBookOrder.increase(tradeAmount)) {
			orderBookOrder.tradePrice = tradePrice;

			if (orderBookOrder.open_amount === 0) {
				const remaining = orderBookOrder.amount - orderBookOrder.tradeAmount;
				if (orderBookOrder.peakAmount > 0 && remaining > 0) {
					// Iceberg refill: move to back of same price-level queue with new peak.
					orderBookOrder.open_amount = Math.min(
						orderBookOrder.peakAmount,
						remaining,
					);
					this.orderBook.requeueFront(orderBookOrder);
					this._increaseVolume(orderBookOrder);
				} else {
					orderBookOrder.deleted = true;
					this._fastRemove(orderBookOrder);
				}
			}

			this._cancelOCO(orderBookOrder);

			this._orders.append(orderBookOrder);

			if (orderBookOrder.deleted) {
				return true;
			}
		}

		return false;
	}

	/**
	 * @param {Order} order
	 */
	_checkCancelOCO(order) {
		return this._oco.has(order.id);
	}

	/**
	 * @param {Order} order
	 */
	_cancelOCO(order) {
		if (!order.oco) {
			return;
		}

		this._oco.append(order.oco);

		let canceled;
		canceled = this.stopBook.cancel(order.oco);
		if (canceled) {
			this._cancelOrder(canceled);
		}
		canceled = this.orderBook.find(order.oco);
		if (canceled) {
			this._cancelOrder(canceled);
		}
	}

	/**
	 * @param {Order} order
	 */
	_cancelOrder(order) {
		order.cancel();
		this._remove(order);
		this._canceled.append(order);
	}

	_processCanceled() {
		this._canceled.orders.forEach((order) => {
			this._decreaseVolume(order, order.open_amount);
			this._oco.remove(order.id);
		});
	}

	/**
	 * @param {Order} order
	 */
	_remove(order) {
		if (!order.hasSymbol(this.symbol)) {
			throw Error(`incorrect symbol: ${order.symbol}`);
		}

		return this.orderBook.remove(order);
	}

	/**
	 * @param {Order} order
	 * @param {Trade|null} trade
	 */
	_matchingOrderResult(order, trade = null) {
		if (!trade) {
			trade = new Trade(order, this._orders.toArray(), this._quoteDivisor);
		}

		this._toOutput(trade);

		const done = new Done(
			trade,
			this._canceled.toArray(),
			this._activated.toArray(),
		);

		if (this._emit) {
			done.trades.forEach((trade) => {
				this.emitter.trade({ trade });
			});
			done.canceled.forEach((id) => {
				this.emitter.canceled({ id });
			});
			done.activated.forEach((id) => {
				this.emitter.activated({ id });
			});
		}

		return done;
	}

	/**
	 * @param {Order} order
	 */
	_fastRemove(order) {
		return this.orderBook.fastRemove(order);
	}

	/**
	 * @param {Order} order
	 */
	_checkSymbol(order) {
		if (!order.hasSymbol(this.symbol)) {
			throw Error(`incorrect symbol: ${order.symbol}`);
		}
	}

	_reset() {
		this._orders.reset();
		this._activated.reset();
		this._canceled.reset();
	}

	/**
	 * @param {Order} order
	 */
	_increaseVolume(order) {
		this.orderBook.volume.increase(order, order.price, order.open_amount);
		this._emitVolume(order);
	}

	/**
	 * @param {Order} order
	 * @param {number} value
	 */
	_decreaseVolume(order, value) {
		this.orderBook.volume.decrease(
			order,
			order.price,
			value || order.tradeAmount || order.amount,
		);
		this._emitVolume(order);
	}

	_emitVolume(order) {
		this._emit &&
			this.emitter.volume({
				side: order.side,
				price: fromInt(order.price, this._ps),
				volume: fromInt(this.orderBook.volume.getVolume(order), this._as),
			});
	}

	/**
	 * Convert internal integers of a trade to the decimals of the caller.
	 * @param {Trade} trade
	 */
	_toOutput(trade) {
		for (const entry of new Set([trade.order, ...trade.orders])) {
			entry.price = fromInt(entry.price, this._ps);
			entry.amount = fromInt(entry.amount, entry.isQuote ? this._ps : this._as);
		}
		const scale = trade.isQuote ? this._ps : this._as;
		trade.processed = fromInt(trade.processed, scale);
		trade.left = fromInt(trade.left, scale);
	}

	_positive(value, scale) {
		const int = toInt(value, scale);
		if (int === 0) {
			throw new Error(`value must be greater than zero: ${value}`);
		}
		return int;
	}

	_checkLot(int, value) {
		if (int % this._lot !== 0) {
			throw new Error(`amount must be a multiple of lotSize: ${value}`);
		}
	}

	_quote(value) {
		const int = this._positive(value, this._ps);
		if (!Number.isSafeInteger(int * this._quoteDivisor)) {
			throw new Error(`quote amount is too big: ${value}`);
		}
		return int;
	}

	_wouldMatchImmediately(order) {
		const best = this.orderBook.volume.best(order.oppositeSide());
		if (!best) return false;
		return order.side === BUY
			? best.price <= order.price
			: best.price >= order.price;
	}

	_priceAmount(price, amount) {
		const p = this._positive(price, this._ps);
		const a = this._positive(amount, this._as);
		if (p % this._tick !== 0) {
			throw new Error(`price must be a multiple of tickSize: ${price}`);
		}
		if (a % this._lot !== 0) {
			throw new Error(`amount must be a multiple of lotSize: ${amount}`);
		}
		if (!Number.isSafeInteger(p * a)) {
			throw new Error(`price * amount is too big: ${price} * ${amount}`);
		}
		return [p, a];
	}
}

Matchingo.SELL = SELL;
Matchingo.BUY = BUY;

Matchingo.MARKET = MARKET;
Matchingo.LIMIT = LIMIT;
Matchingo.STOP_LIMIT = STOP_LIMIT;

Matchingo.IOC = IOC;
Matchingo.FOK = FOK;
