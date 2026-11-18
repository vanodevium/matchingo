import { EventEmitter } from "node:events";

export default class Emitter extends EventEmitter {
	constructor(symbol) {
		super();
		this.symbol = symbol;
	}

	volume(data) {
		this.emit("volume", { symbol: this.symbol, ...data });
	}

	depth(data) {
		this.emit("depth", { symbol: this.symbol, ...data });
	}

	trade(data) {
		this.emit("trade", { symbol: this.symbol, ...data });
	}

	canceled(data) {
		this.emit("canceled", { symbol: this.symbol, ...data });
	}

	activated(data) {
		this.emit("activated", { symbol: this.symbol, ...data });
	}

	bbo(data) {
		this.emit("bbo", { symbol: this.symbol, ...data });
	}

	halt(data) {
		this.emit("halt", { symbol: this.symbol, ...data });
	}
}
