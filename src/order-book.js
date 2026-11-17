import { BUY, BUY_KEY, SELL, SELL_KEY } from "./constants.js";
import OrderedOrders from "./ordered-set-orders-queue.js";
import PriceComparator from "./price-comparator.js";
import Volume from "./volume.js";

export default class OrderBook {
	constructor(symbol) {
		this.symbol = symbol;
		this[SELL] = new OrderedOrders("ASC", "price");
		this[BUY] = new OrderedOrders("DESC", "price");
		this.volume = new Volume(this.symbol);
		this.comparator = new PriceComparator();
	}

	getBestIterator(order) {
		return this[order.oppositeSide()].getBestIterator();
	}

	append(order) {
		if (order.type === 10) {
			throw new Error("MARKET can not be appended to the order book");
		}
		return this[order.side].append(order);
	}

	remove(order) {
		if (order.type === 10) {
			return false;
		}
		return this[order.side].remove(order);
	}

	requeueFront(order) {
		return this[order.side].requeueFront(order);
	}

	fastRemove(order) {
		if (order.type === 10) {
			return false;
		}
		return this[order.side].fastRemove(order);
	}

	find(key) {
		return this[SELL].find(key) || this[BUY].find(key);
	}

	cancel(key) {
		return this[SELL].cancel(key) || this[BUY].cancel(key);
	}

	getRaw() {
		return {
			[this.symbol]: {
				[BUY_KEY]: this[BUY].getRaw(),
				[SELL_KEY]: this[SELL].getRaw(),
			},
		};
	}
}
