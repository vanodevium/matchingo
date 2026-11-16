import { BUY, LIMIT, MARKET, SELL } from "../src/constants.js";
import Comparator from "./../src/price-comparator.js";
import { createTestPriceOrder } from "./constants.js";

let comparator;

beforeEach(() => {
	comparator = new Comparator();
});

test("comparator", () => {
	const market = createTestPriceOrder("1", MARKET, SELL, 0, 10);
	const limit = createTestPriceOrder("1", LIMIT, BUY, 10, 10);

	expect(() => {
		comparator.compare(market, market);
	}).toThrowError();

	comparator.compare(market, limit);
	comparator.compare(limit, market);
	limit.side = SELL;
	comparator.compare(limit, limit);

	market.type = "fake";
	expect(comparator.compare(limit, market)).toBeUndefined();

	market.type = MARKET;
	expect(() => {
		comparator._getLimitLimitPrice(market, market);
	}).toThrowError();

	expect(() => {
		comparator._getMarketLimitPrice(market, market);
	}).toThrowError();

	expect(
		comparator._getLimitLimitPrice(
			createTestPriceOrder("1", LIMIT, BUY, 10, 10),
			createTestPriceOrder("2", LIMIT, BUY, 11, 10),
		),
	).toBe(0);

	expect(
		comparator._getLimitLimitPrice(
			createTestPriceOrder("1", LIMIT, BUY, 11, 10),
			createTestPriceOrder("2", LIMIT, BUY, 10, 10),
		),
	).toBe(10);
});
