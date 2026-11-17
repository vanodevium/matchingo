import { BUY } from "./constants.js";
import OrderedOrders from "./ordered-set-orders-queue.js";

/**
 * Waiting STOP-LIMIT orders.
 * A BUY stop fires when the trade price is at or above the stop price.
 * A SELL stop fires when the trade price is at or below the stop price.
 * Each side has its own sorted book, so the engine reads only the levels that fire.
 */
export default class StopBook {
	constructor(symbol) {
		this.symbol = symbol;
		this._buy = new OrderedOrders("ASC", "stop");
		this._sell = new OrderedOrders("DESC", "stop");
	}

	_side(order) {
		return order.side === BUY ? this._buy : this._sell;
	}

	isEmpty() {
		return (
			this._buy.priceOrdersTreeMap.size() === 0 &&
			this._sell.priceOrdersTreeMap.size() === 0
		);
	}

	getRaw() {
		const raw = this._buy.getRaw();
		for (const [stop, queue] of Object.entries(this._sell.getRaw())) {
			// BUY and SELL stops at one price: show them as one list
			raw[stop] = raw[stop]
				? [...raw[stop].toArray(), ...queue.toArray()]
				: queue;
		}
		return { [this.symbol]: raw };
	}

	getOrders(_symbol, price) {
		const list = (queue) => queue.toArray?.() ?? [];
		return [
			...list(this._buy.getOrders(price)),
			...list(this._sell.getOrders(price)),
		];
	}

	append(order) {
		this._side(order).append(order);
	}

	remove(order) {
		return this._side(order).remove(order);
	}

	/**
	 * Remove and return the orders that the trade price fires.
	 * @param {number} tradePrice
	 * @returns {Order[]}
	 */
	activate(tradePrice) {
		const activated = [];
		this._drain(this._buy, (stop) => stop <= tradePrice, activated);
		this._drain(this._sell, (stop) => stop >= tradePrice, activated);
		return activated;
	}

	_drain(book, fires, activated) {
		const levels = book.priceOrdersTreeMap;
		let first = levels.first();
		while (first && fires(first.k)) {
			const order = first.v.peekFront();
			book.fastRemove(order);
			order.activate();
			activated.push(order);
			first = levels.first();
		}
	}

	cancel(key) {
		const order = this.find(key);
		if (order) {
			this.remove(order);
			return order;
		}
		return false;
	}

	find(key) {
		return this._buy.find(key) || this._sell.find(key);
	}
}
