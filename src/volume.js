import { BUY, SELL } from "./constants.js";
import Numbers from "./ordered-set-numbers.js";

export default class Volume {
	constructor(symbol) {
		this.symbol = symbol;
		this[SELL] = new Numbers("ASC");
		this[BUY] = new Numbers("DESC");
	}

	increase(order, price, amount) {
		if (order.type === 10) {
			return;
		}
		return this[order.side].increase(price, amount);
	}

	decrease(order, price, amount) {
		if (order.type === 10) {
			return;
		}
		return this[order.side].decrease(price, amount);
	}

	get(side) {
		let sum = 0;
		Object.values(this[side].getRaw() || {}).forEach((val) => {
			sum += val;
		});
		return sum;
	}

	best(side) {
		const first = this[side].geyKeys().first();
		if (!first) return null;
		return { price: first.k, amount: this[side].getRaw()[first.k] };
	}

	getVolume(order) {
		return this[order.side].getVolume(order);
	}

	getRaw() {
		return {
			[this.symbol]: {
				[BUY]: this[BUY].getRaw(),
				[SELL]: this[SELL].getRaw(),
			},
		};
	}
}
