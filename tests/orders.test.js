import { BUY, LIMIT, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import {
	createTestPriceOrder,
	createTestStopLimitPrice,
	TestScales,
	TestSymbol,
} from "./constants.js";

let matchingo;

beforeEach(() => {
	matchingo = new Matchingo(TestSymbol, false, TestScales);
});

test("orders: add limit buy", () => {
	const o1 = createTestPriceOrder(1, LIMIT, BUY, 10, 100);
	const result = matchingo.process(o1);

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(0);
	expect(result.processed).toBe(0);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
	expect(matchingo.stopBook.getOrders()).toStrictEqual([]);
});

test("orders: add limit sell", () => {
	const o1 = createTestPriceOrder(1, LIMIT, SELL, 10, 100);
	const result = matchingo.process(o1);

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(0);
	expect(result.processed).toBe(0);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
	expect(matchingo.stopBook.getOrders()).toStrictEqual([]);
});

test("orders: cancel limit buy", () => {
	const o1 = createTestPriceOrder(1, LIMIT, BUY, 10, 100);
	const result = matchingo.process(o1);

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(0);
	expect(result.processed).toBe(0);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
	expect(matchingo.stopBook.getOrders()).toStrictEqual([]);

	expect(matchingo.cancel("fake")).toBeFalsy();
	expect(matchingo.cancel(o1.getKey())).toBeTruthy();

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
});

test("orders: cancel limit sell", () => {
	const o1 = createTestPriceOrder(1, LIMIT, SELL, 10, 100);
	const result = matchingo.process(o1);

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(0);
	expect(result.processed).toBe(0);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
	expect(matchingo.stopBook.getOrders()).toStrictEqual([]);

	expect(matchingo.cancel("fake")).toBeFalsy();
	expect(matchingo.cancel(o1.getKey())).toBeTruthy();

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
});

test("orders: cancel stop limit buy", () => {
	const o1 = createTestStopLimitPrice(1, BUY, 9, 10, 100);

	expect(matchingo.process(o1)).toBe(true);

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
	expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual([
		"9",
	]);

	expect(matchingo.cancel("fake")).toBeFalsy();
	expect(matchingo.cancel(o1.getKey())).toBeTruthy();

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
	expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual(
		[],
	);
});

test("orders: cancel stop limit sell", () => {
	const o1 = createTestStopLimitPrice(1, SELL, 9, 10, 100);

	expect(matchingo.process(o1)).toBe(true);

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
	expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual([
		"9",
	]);

	expect(matchingo.cancel("fake")).toBeFalsy();
	expect(matchingo.cancel(o1.getKey())).toBeTruthy();

	expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
	expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual(
		[],
	);
});
