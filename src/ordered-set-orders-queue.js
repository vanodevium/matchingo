import DenQueue from "denque";
import { SkipList } from "./skip-list.js";

export default class OrderedSetOrdersQueue {
	constructor(sort, key = "price") {
		this.key = key;
		this.unique = Object.create(null);
		this.priceOrdersTreeMap = new SkipList(
			(sort || "").toLowerCase() === "asc" ? (a, b) => a - b : (a, b) => b - a,
		);
	}

	/**
	 * @param {Order} order
	 * @returns {boolean}
	 */
	append(order) {
		if (this.unique[order.id]) {
			return false;
		}

		this.unique[order.id] = order;

		const price = order[this.key];
		let queue = this.priceOrdersTreeMap.get(price);

		if (!queue) {
			queue = new DenQueue();
			this.priceOrdersTreeMap.set(price, queue);
		}

		queue.push(order);

		return true;
	}

	/**
	 * @param {Order} order
	 * @returns {boolean}
	 */
	remove(order) {
		if (!this.unique[order.id]) {
			return false;
		}

		const price = order[this.key];
		const queue = this.priceOrdersTreeMap.get(price);

		if (!queue) {
			return false;
		}

		for (let index = 0; index < queue.length; index++) {
			const element = queue.peekAt(index);
			if (element && element.id === order.id) {
				queue.removeOne(index);
				delete this.unique[order.id];
				if (queue.length === 0) {
					this.priceOrdersTreeMap.del(price);
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * @param {Order} order
	 * @returns {boolean}
	 */
	fastRemove(order) {
		delete this.unique[order.id];
		const first = this.priceOrdersTreeMap.first();
		if (!first) {
			return false;
		}
		const queue = first.v;
		queue.shift();
		if (queue.length === 0) {
			this.priceOrdersTreeMap.del(first.k);
			return true;
		}

		return false;
	}

	/**
	 * @param {string|number} key
	 * @returns {Order|boolean}
	 */
	find(key) {
		return this.unique[key] || false;
	}

	/**
	 * @param {string|number} key
	 * @returns {boolean}
	 */
	cancel(key) {
		const order = this.find(key);
		if (order) {
			return this.remove(order);
		}
		return false;
	}

	/**
	 * Move order from front to back of its price-level queue (iceberg refill).
	 * Does not touch `unique` or the skip-list structure.
	 * @param {Order} order
	 * @returns {boolean}
	 */
	requeueFront(order) {
		const price = order[this.key];
		const queue = this.priceOrdersTreeMap.get(price);
		if (!queue || queue.peekFront() !== order) return false;
		queue.shift();
		queue.push(order);
		return true;
	}

	/**
	 * @param {Number} price
	 * @returns {DenQueue|Array}
	 */
	getOrders(price) {
		return this.priceOrdersTreeMap.get(price) || [];
	}

	getRaw() {
		const obj = Object.create(null);
		this.priceOrdersTreeMap.forEach((node) => {
			obj[node.k] = node.v;
		});
		return obj;
	}
}
