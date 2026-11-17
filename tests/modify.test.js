/**
 * Modify rules:
 * in-place decrease keeps time priority; price change or amount increase
 * re-queues the order (loses priority); re-queued order can match immediately.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

test("modify: unknown id returns false", () => {
	expect(m.modify(99, 100, 10)).toBe(false);
});

test("modify: stop-limit order returns false (not in limit book)", () => {
	m.process(m.newStopLimitOrder(1, BUY, 10, 11, 5));
	expect(m.modify(1, 11, 5)).toBe(false);
	expect(m.stopBook.find(1)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// In-place decrease (same price, smaller or equal amount)
// ---------------------------------------------------------------------------

test("in-place decrease: keeps time priority", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.process(m.newLimitOrder(2, SELL, 100, 10));

	expect(m.modify(1, 100, 6)).toBe(true); // in-place

	// order 1 is still ahead of order 2
	const done = m.process(m.newLimitOrder(3, BUY, 100, 6));
	expect(done.trades[1].id).toBe(1);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy();
});

test("in-place decrease: updates volume and open_amount", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.modify(1, 100, 4);

	expect(m.order(1).open_amount).toBe(4);
	expect(m.bestAsk().amount).toBe(4);
});

test("in-place decrease to current open_amount on partially-filled order", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.process(m.newLimitOrder(2, SELL, 100, 10));
	m.process(m.newLimitOrder(3, BUY, 100, 4)); // order 1: open_amount = 6

	expect(m.modify(1, 100, 6)).toBe(true); // decrease to open_amount → in-place

	const done = m.process(m.newLimitOrder(4, BUY, 100, 6));
	expect(done.trades[1].id).toBe(1);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy();
});

test("in-place decrease: volume correct after partial fill + decrease", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.process(m.newLimitOrder(2, BUY, 100, 3)); // open_amount = 7
	m.modify(1, 100, 5);
	expect(m.order(1).open_amount).toBe(5);
	expect(m.bestAsk().amount).toBe(5);
});

// ---------------------------------------------------------------------------
// Re-queue (price change or amount increase)
// ---------------------------------------------------------------------------

test("price change: re-queues, loses time priority", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.process(m.newLimitOrder(2, SELL, 101, 10));

	m.modify(1, 102, 10); // move to 102 — behind order 2

	const done = m.process(m.newLimitOrder(3, BUY, 101, 10));
	expect(done.trades[1].id).toBe(2);
	expect(m.order(2)).toBeFalsy();
	expect(m.order(1)).toBeTruthy();
});

test("amount increase: re-queues, loses time priority", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 5));
	m.process(m.newLimitOrder(2, SELL, 100, 5));

	m.modify(1, 100, 10); // increase → re-queue to back

	const done = m.process(m.newLimitOrder(3, BUY, 100, 5));
	expect(done.trades[1].id).toBe(2);
	expect(m.order(1)).toBeTruthy();
});

test("re-queued order matches immediately when it now crosses", () => {
	m.process(m.newLimitOrder(1, BUY, 100, 10));
	m.process(m.newLimitOrder(2, SELL, 110, 10));

	// lower the ask to cross with the bid
	const done = m.modify(2, 100, 10);

	expect(done.trades.length).toBe(2);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeFalsy();
});
