/**
 * Engine lifecycle, process guards, sequence/timestamp,
 * order()/cancel() API, order book duplicate handling,
 * Done result shape.
 */

import { BUY, SELL } from "../src/constants.js";
import { ErrorCode } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test("construction: symbol required", () => {
	expect(() => new Matchingo()).toThrow();
	expect(() => new Matchingo("")).toThrow();
});

test("construction: priceScale required", () => {
	expect(() => new Matchingo(TestSymbol)).toThrow("priceScale");
	expect(
		() => new Matchingo(TestSymbol, { priceScale: -1, amountScale: 0 }),
	).toThrow("priceScale");
});

test("construction: amountScale required", () => {
	expect(() => new Matchingo(TestSymbol, { priceScale: 2 })).toThrow(
		"amountScale",
	);
});

test("construction: decimalFrom static helper", () => {
	expect(Matchingo.decimalFrom("1.25", 2)).toBe(125);
	expect(Matchingo.decimalFrom(10, 0)).toBe(10);
});

// ---------------------------------------------------------------------------
// Process guards
// ---------------------------------------------------------------------------

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

const rejected = (fn, code) => {
	try {
		fn();
	} catch (error) {
		expect(error.code).toBe(code);
		return;
	}
	throw new Error(`expected ${code}`);
};

test("submit: undefined/null is rejected", () => {
	rejected(() => m.submit(undefined), ErrorCode.INVALID_ORDER);
	rejected(() => m.submit(null), ErrorCode.INVALID_ORDER);
});

test("submit: duplicate id is rejected", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	rejected(
		() => m.submit(m.newLimitOrder(1, SELL, 10, 5)),
		ErrorCode.DUPLICATE_ORDER_ID,
	);
});

test("submit: the same order object can not be submitted twice", () => {
	const order = m.newLimitOrder(1, BUY, 10, 5);
	m.submit(order);
	m.cancel(1);
	rejected(() => m.submit(order), ErrorCode.INVALID_ORDER);
});

test("submit: stop-limit is stored in the stop book", () => {
	const result = m.submit(m.newStopLimitOrder(1, BUY, 15, 15, 5));
	expect(result.stored).toBe(true);
	expect(m.stopBook.find(1)).toBeTruthy();
	expect(m.orderBook.find(1)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Sequence and timestamp
// ---------------------------------------------------------------------------

test("seq: first order gets 1, increments per call", () => {
	const d1 = m.submit(m.newLimitOrder(1, BUY, 10, 5));
	const d2 = m.submit(m.newLimitOrder(2, BUY, 10, 5));
	expect(d1.order.seq).toBe(1);
	expect(d2.order.seq).toBe(2);
});

test("seq: duplicate id does not increment counter", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(() => m.submit(m.newLimitOrder(1, BUY, 10, 5))).toThrow(); // rejected
	const d2 = m.submit(m.newLimitOrder(2, BUY, 10, 5));
	expect(d2.order.seq).toBe(2);
});

test("seq: stop-limit receives seq when processed", () => {
	m.submit(m.newStopLimitOrder(1, BUY, 15, 15, 5));
	expect(m.order(1).seq).toBe(1);
});

test("seq: result carries the sequence of the command", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	const done = m.submit(m.newLimitOrder(2, SELL, 10, 5));
	expect(m.order(1)).toBeNull();
	expect(done.sequence).toBe(2);
	expect(done.order.seq).toBe(2);
});

test("seq: replace and a re-queued modify take a new sequence", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(m.replace(1, m.newLimitOrder(1, BUY, 11, 5)).sequence).toBe(2);
	expect(m.modify(1, 12, 5).sequence).toBe(3);
});

test("timestamp: assigned to recent unix-ms on submit", () => {
	const before = Date.now();
	const done = m.submit(m.newLimitOrder(1, BUY, 10, 5));
	const after = Date.now();
	expect(done.order.timestamp).toBeGreaterThanOrEqual(before);
	expect(done.order.timestamp).toBeLessThanOrEqual(after);
});

test("timestamp: uses the injected clock", () => {
	const book = new Matchingo(TestSymbol, { ...TestScales, clock: () => 777 });
	expect(book.submit(book.newLimitOrder(1, BUY, 10, 5)).order.timestamp).toBe(
		777,
	);
});

test("timestamp: a stamped order keeps its time and does not read the clock", () => {
	let reads = 0;
	const book = new Matchingo(TestSymbol, {
		...TestScales,
		clock: () => {
			reads++;
			return 1;
		},
	});
	const order = book.newLimitOrder(1, BUY, 10, 5);
	order.timestamp = 555;
	expect(book.submit(order).order.timestamp).toBe(555);
	expect(reads).toBe(0);
});

// ---------------------------------------------------------------------------
// order() and cancel()
// ---------------------------------------------------------------------------

test("order(): finds resting limit order", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(m.order(1)).toBeTruthy();
});

test("order(): finds stop-limit order", () => {
	m.submit(m.newStopLimitOrder(1, BUY, 15, 15, 5));
	expect(m.order(1)).toBeTruthy();
});

test("order(): returns null for unknown id", () => {
	expect(m.order(99)).toBeNull();
});

test("order(): returns a copy", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.order(1).price = 99;
	expect(m.order(1).price).toBe(10);
});

test("cancel(): limit buy — removed from book, volume cleared", () => {
	const o = m.newLimitOrder(1, BUY, 10, 100);
	m.submit(o);
	expect(m.orderBook.volume.getVolume(o)).toBe(100);
	expect(m.cancel(1)).toBe(true);
	expect(m.orderBook.volume.getVolume(o)).toBe(0);
	expect(m.order(1)).toBeFalsy();
});

test("cancel(): limit sell — removed from book, volume cleared", () => {
	const o = m.newLimitOrder(1, SELL, 10, 50);
	m.submit(o);
	expect(m.cancel(1)).toBe(true);
	expect(m.order(1)).toBeFalsy();
});

test("cancel(): stop-limit — removed from stop book", () => {
	m.submit(m.newStopLimitOrder(1, BUY, 9, 10, 100));
	expect(m.cancel(1)).toBe(true);
	expect(m.stopBook.find(1)).toBeFalsy();
	expect(m.stopBook.isEmpty()).toBe(true);
});

test("cancel(): non-existent id returns false", () => {
	expect(m.cancel("fake")).toBe(false);
	expect(m.cancel(99)).toBe(false);
});

// ---------------------------------------------------------------------------
// Done result shape
// ---------------------------------------------------------------------------

test("done shape: resting limit — no trades, correct fields", () => {
	const done = m.submit(m.newLimitOrder(1, BUY, 100, 10));
	expect(done.order.id).toBe(1);
	expect(done.order.isQuote).toBe(false);
	expect(done.trades).toEqual([]);
	expect(done.processed).toBe(0);
	expect(done.left).toBe(10);
	expect(done.quantity).toBe(10);
	expect(done.stored).toBe(true);
	expect(done.sequence).toBe(1);
	expect(done.canceled).toEqual([]);
	expect(done.activated).toEqual([]);
	expect(done.activations).toEqual([]);
});

test("done shape: filled limit — trades contain taker then maker", () => {
	m.submit(m.newLimitOrder(2, SELL, 10, 5));
	const done = m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(done.trades.length).toBe(2);
	expect(done.trades[0].id).toBe(1); // taker
	expect(done.trades[1].id).toBe(2); // maker
	expect(done.trades[1].tradeId).toBe(1);
	expect(done.processed).toBe(5);
	expect(done.left).toBe(0);
	expect(done.stored).toBe(false);
});

test("done shape: one trade entry per maker fill, trade ids count up", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 2));
	m.submit(m.newLimitOrder(2, SELL, 11, 2));
	const done = m.submit(m.newLimitOrder(3, BUY, 11, 4));
	expect(done.trades.map((t) => [t.id, t.price, t.amount])).toEqual([
		[3, 11, 4],
		[1, 10, 2],
		[2, 11, 2],
	]);
	expect(done.trades.slice(1).map((t) => t.tradeId)).toEqual([1, 2]);
});

test("done shape: quote market — isQuote flag on taker entry", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 10));
	const done = m.submit(m.newMarketBuyQuoteOrder(2, 50));
	expect(done.order.isQuote).toBe(true);
	expect(done.trades[0].isQuote).toBe(true);
	expect(done.trades[1].isQuote).toBe(false);
});
