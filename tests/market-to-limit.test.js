/**
 * Market-to-limit and replace.
 */

import { BUY, IOC, SELL } from "../src/constants.js";
import { ErrorCode } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, emitter: true });
});

// ---------------------------------------------------------------------------
// Market-to-limit
// ---------------------------------------------------------------------------

describe("market-to-limit", () => {
	test("the remainder rests at the price of the last fill", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		m.submit(m.newLimitOrder(2, SELL, 12, 2));

		const done = m.submit(m.newMarketToLimitOrder(3, BUY, 10));

		expect(done.processed).toBe(4);
		expect(done.left).toBe(6);
		expect(done.stored).toBe(true);
		expect(done.canceled).toEqual([]);
		expect(m.bestBid()).toEqual({ price: 12, amount: 6 });
		expect(m.order(3)).toMatchObject({ type: Matchingo.LIMIT, price: 12 });
	});

	test("it can be filled later as a maker", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		m.submit(m.newMarketToLimitOrder(2, BUY, 5));
		const done = m.submit(m.newLimitOrder(3, SELL, 10, 3));
		expect(done.trades.map((t) => t.id)).toEqual([3, 2]);
	});

	test("without any fill it is canceled", () => {
		const done = m.submit(m.newMarketToLimitOrder(1, BUY, 5));
		expect(done.canceled).toEqual([1]);
		expect(done.stored).toBe(false);
		expect(m.bestBid()).toBeNull();
	});

	test("fully filled: nothing rests", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 5));
		const done = m.submit(m.newMarketToLimitOrder(2, BUY, 5));
		expect(done.stored).toBe(false);
		expect(done.canceled).toEqual([]);
	});

	test("stopped by self-trade prevention: canceled", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		m.submit(m.newLimitOrder(2, SELL, 11, 2).setSTP("a", 0));
		const done = m.submit(
			m
				.newMarketToLimitOrder(3, BUY, 10)
				.setSTP("a", Matchingo.STP_CANCEL_NEWEST),
		);
		expect(done.processed).toBe(2);
		expect(done.canceled).toEqual([3]);
		expect(m.order(3)).toBeNull();
	});

	test("IOC: the remainder is canceled", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		const done = m.submit(m.newMarketToLimitOrder(2, BUY, 5).setTIF(IOC));
		expect(done.canceled).toEqual([2]);
	});

	test("a plain market order does not rest", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		const done = m.submit(m.newMarketOrder(2, BUY, 5));
		expect(done.canceled).toEqual([2]);
		expect(done.stored).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

describe("replace", () => {
	test("cancels the old order and submits the new one", () => {
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		const done = m.replace(1, m.newLimitOrder(2, BUY, 11, 3));
		expect(done.canceled).toEqual([1]);
		expect(done.stored).toBe(true);
		expect(m.order(1)).toBeNull();
		expect(m.bestBid()).toEqual({ price: 11, amount: 3 });
	});

	test("the new order may reuse the old id", () => {
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		const done = m.replace(1, m.newLimitOrder(1, BUY, 11, 3));
		expect(done.canceled).toEqual([1]);
		expect(m.order(1)).toMatchObject({ price: 11, amount: 3 });
	});

	test("the new order goes to the back of its queue", () => {
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		m.submit(m.newLimitOrder(2, BUY, 10, 5));
		m.replace(1, m.newLimitOrder(1, BUY, 10, 5));
		const done = m.submit(m.newLimitOrder(3, SELL, 10, 5));
		expect(done.trades[1].id).toBe(2);
	});

	test("the new order matches like any new order", () => {
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		m.submit(m.newLimitOrder(2, SELL, 12, 5));
		const done = m.replace(1, m.newLimitOrder(3, BUY, 12, 5));
		expect(done.processed).toBe(5);
		expect(done.canceled).toEqual([1]);
	});

	test("a replaced stop order", () => {
		m.submit(m.newStopLimitOrder(1, BUY, 20, 21, 5));
		const done = m.replace(1, m.newLimitOrder(2, BUY, 10, 1));
		expect(done.canceled).toEqual([1]);
		expect(m.stopBook.find(1)).toBeFalsy();
	});

	test("an invalid new order leaves the old one untouched", () => {
		m = new Matchingo(TestSymbol, {
			...TestScales,
			instrument: { tickSize: 5 },
		});
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		const before = JSON.stringify(m.dump());
		expect(() => m.replace(1, m.newLimitOrder(1, BUY, 11, 5))).toThrow(
			expect.objectContaining({ code: ErrorCode.TICK_SIZE }),
		);
		expect(JSON.stringify(m.dump())).toBe(before);
	});

	test("a duplicate id of another order leaves the old one untouched", () => {
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		m.submit(m.newLimitOrder(2, BUY, 9, 5));
		expect(() => m.replace(1, m.newLimitOrder(2, BUY, 11, 5))).toThrow(
			expect.objectContaining({ code: ErrorCode.DUPLICATE_ORDER_ID }),
		);
		expect(m.order(1)).toBeTruthy();
	});

	test("an unknown order", () => {
		expect(() => m.replace(9, m.newLimitOrder(1, BUY, 10, 5))).toThrow(
			expect.objectContaining({ code: ErrorCode.ORDER_NOT_FOUND }),
		);
		expect(m.order(1)).toBeNull();
	});

	test("the old id comes first in canceled", () => {
		let now = 1000;
		m = new Matchingo(TestSymbol, { ...TestScales, clock: () => now });
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		m.submit(m.newLimitOrder(2, BUY, 9, 5).setExpiry(2000));
		now = 2000;
		const done = m.replace(1, m.newLimitOrder(3, BUY, 8, 5));
		expect(done.canceled).toEqual([1, 2]);
	});

	test("emits a cancel event for the old order", () => {
		const ids = [];
		m.emitter.on("canceled", ({ id }) => ids.push(id));
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		m.replace(1, m.newLimitOrder(2, BUY, 10, 5));
		expect(ids).toEqual([1]);
	});
});
