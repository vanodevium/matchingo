import { createHash } from "node:crypto";
import { quoteOf } from "../decimal.js";

export default class Trade {
	constructor(tradeOrder, orders = [], quoteDivisor = 1) {
		this.quoteDivisor = quoteDivisor;
		this.order = null;
		this.isQuote = false;
		this.amount = 0;
		this.processed = 0;
		this.left = 0;
		this.orders = [];
		this.id = null;
		this.setOrder(tradeOrder);
		this.setOrders(orders);
		this.id = this.computeId();
	}

	computeId() {
		const parts = [this.order.id, this.order.price, this.order.amount];
		for (const o of this.orders.slice(1)) {
			parts.push(o.id, o.price, o.amount);
		}
		return createHash("sha256")
			.update(parts.join(":"))
			.digest("hex")
			.slice(0, 16);
	}

	setOrder(order) {
		this.isQuote = order.isQuote();
		this.amount = order.amount;
		this.order = {
			id: order.id,
			price: order.tradePrice || order.price,
			isQuote: order.isQuote(),
			amount: 0,
			role: order.role,
			seq: order.seq,
			timestamp: order.timestamp,
		};
		order.resetTrade();
	}

	setOrders(orders = []) {
		if (!orders?.length) {
			return;
		}
		orders.forEach((order) => {
			this.appendOrder(order);
		});
		this.calculateLeft();
		this.unshiftOrder();
	}

	appendOrder(order) {
		this.orders.push({
			id: order.id,
			price: order.tradePrice,
			isQuote: order.isQuote(),
			amount: order.tradeAmount,
			role: order.role,
			seq: order.seq,
			timestamp: order.timestamp,
		});
		this.processed += this.isQuote
			? quoteOf(order.tradeAmount, order.tradePrice, this.quoteDivisor)
			: order.tradeAmount;
		order.resetTrade();
	}

	unshiftOrder() {
		if (this.orders.length) {
			this.orders.unshift(this.order);
		}
	}

	calculateLeft() {
		this.order.amount = this.processed;
		this.left = this.amount - this.processed;
	}
}
