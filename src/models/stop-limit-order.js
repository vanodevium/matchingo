import { STOP_LIMIT } from "../constants.js";
import Order from "./order.js";

export default class StopLimitOrder extends Order {
	constructor(symbol, id, side, stop, price, amount) {
		super(symbol, id, STOP_LIMIT, side, price, amount);
		this.stop = stop;
	}
}
