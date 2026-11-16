import { LIMIT, MARKET, MARKET_PRICE } from "./constants.js";
import Order from "./models/order.js";
import StopLimitOrder from "./models/stop-limit-order.js";

export function createMarketOrder(symbol, id, side, amount) {
	return new Order(symbol, id, MARKET, side, MARKET_PRICE, amount);
}

export function createLimitOrder(symbol, id, side, price, amount) {
	return new Order(symbol, id, LIMIT, side, price, amount);
}

export function createStopLimitOrder(symbol, id, side, stop, price, amount) {
	return new StopLimitOrder(symbol, id, side, stop, price, amount);
}
