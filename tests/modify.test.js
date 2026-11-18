/**
 * Modify rules:
 * in-place decrease keeps time priority; price change or amount increase
 * re-queues the order (loses priority); re-queued order can match immediately.
 */

import { BUY, SELL } from "../src/constants.js";
import { ErrorCode } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

test("modify: unknown id is rejected", () => {
	expect(() => m.modify(99, 100, 10)).toThrow(
		expect.objectContaining({ code: ErrorCode.ORDER_NOT_FOUND }),
	);
});

test("modify: stop order is the wrong kind", () => {
	m.submit(m.newStopLimitOrder(1, BUY, 10, 11, 5));
	expect(() => m.modify(1, 11, 5)).toThrow(
		expect.objectContaining({ code: ErrorCode.WRONG_ORDER_KIND }),
	);
	expect(m.stopBook.find(1)).toBeTruthy();
});

test("modify: rejected while halted", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.halt();
	expect(() => m.modify(1, 10, 4)).toThrow(
		expect.objectContaining({ code: ErrorCode.TRADING_HALTED }),
	);
});

test("modify: new values must satisfy the instrument", () => {
	m = new Matchingo(TestSymbol, { ...TestScales, instrument: { tickSize: 5 } });
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(() => m.modify(1, 12, 5)).toThrow(
		expect.objectContaining({ code: ErrorCode.TICK_SIZE }),
	);
	expect(m.order(1).price).toBe(10);
});

// ---------------------------------------------------------------------------
// In-place decrease (same price, smaller or equal amount)
// ---------------------------------------------------------------------------

test("in-place decrease: keeps time priority", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	m.submit(m.newLimitOrder(2, SELL, 100, 10));

	expect(m.modify(1, 100, 6).stored).toBe(true); // in-place

	// order 1 is still ahead of order 2
	const done = m.submit(m.newLimitOrder(3, BUY, 100, 6));
	expect(done.trades[1].id).toBe(1);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy();
});

test("in-place decrease: updates volume and open", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	m.modify(1, 100, 4);

	expect(m.order(1).open).toBe(4);
	expect(m.bestAsk().amount).toBe(4);
});

test("in-place decrease to current open on partially-filled order", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	m.submit(m.newLimitOrder(2, SELL, 100, 10));
	m.submit(m.newLimitOrder(3, BUY, 100, 4)); // order 1: open = 6

	expect(m.modify(1, 100, 6).stored).toBe(true); // decrease to open → in-place

	const done = m.submit(m.newLimitOrder(4, BUY, 100, 6));
	expect(done.trades[1].id).toBe(1);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy();
});

test("in-place decrease: volume correct after partial fill + decrease", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	m.submit(m.newLimitOrder(2, BUY, 100, 3)); // open = 7
	m.modify(1, 100, 5);
	expect(m.order(1).open).toBe(5);
	expect(m.bestAsk().amount).toBe(5);
});

// ---------------------------------------------------------------------------
// Re-queue (price change or amount increase)
// ---------------------------------------------------------------------------

test("price change: re-queues, loses time priority", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	m.submit(m.newLimitOrder(2, SELL, 101, 10));

	m.modify(1, 102, 10); // move to 102 — behind order 2

	const done = m.submit(m.newLimitOrder(3, BUY, 101, 10));
	expect(done.trades[1].id).toBe(2);
	expect(m.order(2)).toBeFalsy();
	expect(m.order(1)).toBeTruthy();
});

test("amount increase: re-queues, loses time priority", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 5));
	m.submit(m.newLimitOrder(2, SELL, 100, 5));

	m.modify(1, 100, 10); // increase → re-queue to back

	const done = m.submit(m.newLimitOrder(3, BUY, 100, 5));
	expect(done.trades[1].id).toBe(2);
	expect(m.order(1)).toBeTruthy();
});

test("re-queued order matches immediately when it now crosses", () => {
	m.submit(m.newLimitOrder(1, BUY, 100, 10));
	m.submit(m.newLimitOrder(2, SELL, 110, 10));

	// lower the ask to cross with the bid
	const done = m.modify(2, 100, 10);

	expect(done.trades.length).toBe(2);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Dormant stops
// ---------------------------------------------------------------------------

test("modifyStop: changes stop, price and amount; loses priority", () => {
	m.submit(m.newStopLimitOrder(1, BUY, 20, 21, 5));
	m.submit(m.newStopLimitOrder(2, BUY, 20, 21, 5));

	m.modifyStop(1, 20, 22, 7);

	const first = m.stopBook.getOrders(TestSymbol, 20).map((o) => o.id);
	expect(first).toEqual([2, 1]);
	expect(m.order(1)).toMatchObject({ stop: 20, price: 22, amount: 7 });
});

test("modifyStop: price is ignored for stop-market", () => {
	m.submit(m.newStopMarketOrder(1, BUY, 20, 5));
	m.modifyStop(1, 21, 99, 4);
	expect(m.order(1)).toMatchObject({ stop: 21, price: 0, amount: 4 });
});

test("modifyStop: a limit order is the wrong kind", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(() => m.modifyStop(1, 20, 21, 5)).toThrow(
		expect.objectContaining({ code: ErrorCode.WRONG_ORDER_KIND }),
	);
	expect(() => m.modifyStop(9, 20, 21, 5)).toThrow(
		expect.objectContaining({ code: ErrorCode.ORDER_NOT_FOUND }),
	);
});

test("modifyStop: the moved stop activates at its new price", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 5));
	m.submit(m.newStopMarketOrder(2, BUY, 50, 1));
	m.modifyStop(2, 10, null, 1);
	const done = m.submit(m.newMarketOrder(3, BUY, 1));
	expect(done.activated).toEqual([2]);
});
