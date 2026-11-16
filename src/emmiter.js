import { EventEmitter } from "node:events";

export default class Emitter extends EventEmitter {
	constructor(symbol) {
		super();
		this.symbol = symbol;
		this.obj = { symbol: this.symbol };
	}

	volume(data) {
		this.emit(this.symbol, { ...this.obj, type: "volume" }, data);
	}

	depth(data) {
		this.emit(this.symbol, { ...this.obj, type: "depth" }, data);
	}

	activated(data) {
		this.emit(this.symbol, { ...this.obj, type: "activated" }, data);
	}

	canceled(data) {
		this.emit(this.symbol, { ...this.obj, type: "canceled" }, data);
	}

	trade(data) {
		this.emit(this.symbol, { ...this.obj, type: "trade" }, data);
	}
}
