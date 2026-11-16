import OrderedOrders from "./ordered-set-orders-queue.js";

export default class StopBook {
	constructor(symbol) {
		this.symbol = symbol;
		this.orders = new OrderedOrders("ASC", "stop");
	}

	getRaw() {
		return {
			[this.symbol]: this.orders.getRaw(),
		};
	}

	getOrders(_symbol, price) {
		return this.orders.getOrders(price);
	}

	append(order) {
		this.orders.append(order);
	}

	remove(order) {
		return this.orders.remove(order);
	}

	activate(currentPrice) {
		const activated = [];

		const orders = this.orders.priceOrdersTreeMap.get(currentPrice);
		if (!orders) {
			return activated;
		}

		let stopLimit = orders.shift();
		while (stopLimit) {
			stopLimit.activate();
			activated.push(stopLimit);
			stopLimit = orders.shift();
		}

		this.orders.priceOrdersTreeMap.del(currentPrice);

		return activated;
	}

	cancel(key) {
		const order = this.orders.find(key);
		if (order) {
			this.orders.cancel(key);
			return order;
		}
		return false;
	}

	find(key) {
		return this.orders.find(key);
	}
}
