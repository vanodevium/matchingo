import Order from "../src/models/order.js";

export const TestSymbol = "BTC/USD";

export function createTestPriceOrder(id, type, side, price, amount) {
	return new Order(TestSymbol, id, type, side, price, amount);
}

export const TestScales = { priceScale: 0, amountScale: 0 };
export const DecimalScales = { priceScale: 3, amountScale: 3 };
