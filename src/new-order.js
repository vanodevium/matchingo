import {
	LIMIT,
	MARKET,
	MARKET_PRICE,
	STOP_LIMIT,
	STOP_MARKET,
	TRAILING_STOP,
} from "./constants.js";
import Order from "./models/order.js";

export function createMarketOrder(symbol, id, side, amount) {
	return new Order(symbol, id, MARKET, side, MARKET_PRICE, amount);
}

export function createLimitOrder(symbol, id, side, price, amount) {
	return new Order(symbol, id, LIMIT, side, price, amount);
}

export function createStopLimitOrder(symbol, id, side, stop, price, amount) {
	const order = new Order(symbol, id, STOP_LIMIT, side, price, amount);
	order.stop = stop;
	return order;
}

export function createStopMarketOrder(symbol, id, side, stop, amount) {
	const order = new Order(symbol, id, STOP_MARKET, side, MARKET_PRICE, amount);
	order.stop = stop;
	return order;
}

export function createTrailingStopOrder(symbol, id, side, stop, amount) {
	const order = new Order(
		symbol,
		id,
		TRAILING_STOP,
		side,
		MARKET_PRICE,
		amount,
	);
	order.stop = stop;
	return order;
}
