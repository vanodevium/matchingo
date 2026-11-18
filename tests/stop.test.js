/**
 * Stop-limit order rules:
 * placement, activation triggers (buy/sell, price-jump, mid-level),
 * cascade, event emission, stop book internals.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import StopBook from "../src/stop-book.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, emitter: true });
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

test("stop-limit is added to stop book, not order book", () => {
	m.submit(m.newStopLimitOrder(1, BUY, 10, 11, 5));
	expect(m.stopBook.find(1)).toBeTruthy();
	expect(m.orderBook.find(1)).toBeFalsy();
});

test("stop does not fire when no trade happens", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 5));
	m.submit(m.newStopLimitOrder(100, BUY, 10, 11, 1));

	// Place a limit buy that does not cross — no trade
	const done = m.submit(m.newLimitOrder(2, BUY, 9, 1));
	expect(done.trades).toEqual([]);
	expect(done.activated).toEqual([]);
	expect(m.stopBook.find(100)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Activation triggers
// ---------------------------------------------------------------------------

test("BUY stop activates when trade price reaches stop", () => {
	m.submit(m.newStopLimitOrder(100, BUY, 10, 15, 5));
	m.submit(m.newLimitOrder(1, SELL, 12, 10));

	const done = m.submit(m.newMarketOrder(2, BUY, 10));
	expect(done.activated).toContain(100);
	expect(m.stopBook.find(100)).toBeFalsy();
});

test("BUY stop does NOT activate when trade price stays below stop", () => {
	m.submit(m.newStopLimitOrder(100, BUY, 12, 13, 5));
	m.submit(m.newLimitOrder(1, SELL, 11, 10));

	const done = m.submit(m.newMarketOrder(2, BUY, 10));
	expect(done.activated).toEqual([]);
	expect(m.stopBook.find(100)).toBeTruthy();
});

test("SELL stop activates when trade price reaches stop", () => {
	m.submit(m.newStopLimitOrder(100, SELL, 10, 9, 5));
	m.submit(m.newLimitOrder(1, BUY, 8, 10));

	const done = m.submit(m.newMarketOrder(2, SELL, 10));
	expect(done.activated).toContain(100);
});

test("BUY stop activates when trade price jumps over the stop", () => {
	m.submit(m.newStopLimitOrder(100, BUY, 10, 9, 1));
	m.submit(m.newLimitOrder(1, SELL, 12, 1));

	const done = m.submit(m.newMarketOrder(2, BUY, 1));
	expect(done.activated).toContain(100);
	// activated order keeps its limit price
	expect(m.order(100).price).toBe(9);
});

test("stop fires on a trade in the middle of a price level", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 10, 1));
	m.submit(m.newStopLimitOrder(100, BUY, 10, 10, 1));

	const done = m.submit(m.newMarketOrder(3, BUY, 1));

	// caller fills order 1; stop activates and fills order 2
	expect(done.trades.map((t) => t.id)).toStrictEqual([3, 1]);
	expect(done.activations[0].trades.map((t) => t.id)).toStrictEqual([100, 2]);
});

// ---------------------------------------------------------------------------
// Activation processing
// ---------------------------------------------------------------------------

test("activated stop is matched immediately (not only added to book)", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 11, 5));
	m.submit(m.newStopLimitOrder(100, BUY, 10, 11, 5));

	const done = m.submit(m.newMarketOrder(3, BUY, 1));

	expect(done.activated).toContain(100);
	expect(done.activations.length).toBe(1);
	expect(done.activations[0].order.id).toBe(100);
	expect(done.activations[0].processed).toBe(5);
	expect(m.order(100)).toBeFalsy();
	expect(m.orderBook.volume.get(SELL)).toBe(0);
});

test("activated stop rests in book when it does not cross", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newStopLimitOrder(100, BUY, 10, 9, 5)); // limit 9 < best ask 10

	m.submit(m.newMarketOrder(3, BUY, 1));

	expect(m.order(100).price).toBe(9);
	expect(m.orderBook.volume.get(BUY)).toBe(5);
});

test("activated stop can fire other stop orders (cascade)", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 12, 1));
	m.submit(m.newStopLimitOrder(100, BUY, 10, 12, 1));
	m.submit(m.newStopLimitOrder(101, BUY, 12, 13, 1));

	const done = m.submit(m.newMarketOrder(3, BUY, 1));

	expect(done.activated).toContain(100);
	expect(done.activations.map((a) => a.order.id)).toStrictEqual([100]);
	expect(done.activations[0].activated).toContain(101);
	// the cascade is nested in the result of the stop that fired it
	expect(done.activations[0].activations.map((a) => a.order.id)).toStrictEqual([
		101,
	]);
});

test("activated stop emits its own trade and activated events", () => {
	const events = [];
	m.emitter.on("trade", (data) =>
		events.push(["trade", [data.takerId, data.makerId]]),
	);
	m.emitter.on("activated", (data) => events.push(["activated", data.id]));
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 11, 1));
	m.submit(m.newStopLimitOrder(100, BUY, 10, 11, 1));
	events.length = 0;

	m.submit(m.newMarketOrder(3, BUY, 1));

	const trades = events.filter(([t]) => t === "trade").map(([, id]) => id);
	expect(trades).toStrictEqual([
		[3, 1],
		[100, 2],
	]);
	expect(events).toContainEqual(["activated", 100]);
});

test("stop order activation preserves order identity and rests", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 11, 11));
	m.submit(m.newStopLimitOrder(100, SELL, 10, 11, 11));

	const done = m.submit(m.newLimitOrder(3, BUY, 10, 1));
	expect(done.activated).toContain(100);
	// order 2 (11 units) + stop 100 activated as limit (11 units) both rest at 11
	expect(m.orderBook.volume.get(SELL)).toBe(22);
});

// ---------------------------------------------------------------------------
// Stop book — internal unit tests
// ---------------------------------------------------------------------------

test("stop book: BUY and SELL use separate sides", () => {
	const book = new StopBook(TestSymbol);
	book.append(m.newStopLimitOrder(1, BUY, 10, 11, 1));
	book.append(m.newStopLimitOrder(2, SELL, 10, 9, 1));

	expect(book.find(1).side).toBe(BUY);
	expect(book.find(2).side).toBe(SELL);
	expect(book.getOrders(TestSymbol, 10).length).toBe(2);

	// price 11 fires only the BUY stop
	expect(book.activate(11).map((o) => o.id)).toStrictEqual([1]);
	// price 10 fires the SELL stop
	expect(book.activate(10).map((o) => o.id)).toStrictEqual([2]);
	expect(book.isEmpty()).toBe(true);
});

test("stop book: BUY stops activate at stop price, lowest first", () => {
	const book = new StopBook(TestSymbol);
	book.append(m.newStopLimitOrder(1, BUY, 10, 11, 1));
	book.append(m.newStopLimitOrder(2, BUY, 12, 13, 1));

	expect(book.activate(11).map((o) => o.id)).toStrictEqual([1]);
	expect(book.find(2)).toBeTruthy();
});

test("stop book: SELL stops activate at stop price, highest first", () => {
	const book = new StopBook(TestSymbol);
	book.append(m.newStopLimitOrder(1, SELL, 10, 9, 1));
	book.append(m.newStopLimitOrder(2, SELL, 8, 7, 1));

	expect(book.activate(11).length).toBe(0);
	expect(book.activate(9).map((o) => o.id)).toStrictEqual([1]);
	expect(book.find(2)).toBeTruthy();
});

test("stop book: activation order — by stop price then insertion time", () => {
	const book = new StopBook(TestSymbol);
	book.append(m.newStopLimitOrder(1, BUY, 12, 13, 1));
	book.append(m.newStopLimitOrder(2, BUY, 10, 11, 1));
	book.append(m.newStopLimitOrder(3, BUY, 10, 11, 1));
	book.append(m.newStopLimitOrder(4, SELL, 20, 19, 1));
	book.append(m.newStopLimitOrder(5, SELL, 22, 21, 1));

	expect(book.activate(21).map((o) => o.id)).toStrictEqual([2, 3, 1, 5]);
	expect(book.find(4)).toBeTruthy();
});

test("stop book: activated order is removed", () => {
	const book = new StopBook(TestSymbol);
	book.append(m.newStopLimitOrder(1, BUY, 10, 11, 100));
	book.activate(10);
	expect(book.find(1)).toBe(false);
});
