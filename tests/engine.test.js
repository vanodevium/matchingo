/**
 * Engine lifecycle, process guards, sequence/timestamp,
 * order()/cancel() API, order book duplicate handling,
 * Done result shape, Volume.hasEnough, PriceComparator edge cases.
 */

import { BUY, LIMIT, MARKET, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import PriceComparator from "../src/price-comparator.js";
import Volume from "../src/volume.js";
import { createTestPriceOrder, TestScales, TestSymbol } from "./constants.js";

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

test("process: undefined/null returns undefined", () => {
	expect(m.process(undefined)).toBeUndefined();
	expect(m.process(null)).toBeUndefined();
});

test("process: duplicate id returns false", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	expect(m.process(m.newLimitOrder(1, SELL, 10, 5))).toBe(false);
});

test("process: stop-limit returns true and lives in stop book", () => {
	const result = m.process(m.newStopLimitOrder(1, BUY, 15, 15, 5));
	expect(result).toBe(true);
	expect(m.stopBook.find(1)).toBeTruthy();
	expect(m.orderBook.find(1)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Sequence and timestamp
// ---------------------------------------------------------------------------

test("seq: first order gets 1, increments per call", () => {
	const d1 = m.process(m.newLimitOrder(1, BUY, 10, 5));
	const d2 = m.process(m.newLimitOrder(2, BUY, 10, 5));
	expect(d1.order.seq).toBe(1);
	expect(d2.order.seq).toBe(2);
});

test("seq: duplicate id does not increment counter", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	m.process(m.newLimitOrder(1, BUY, 10, 5)); // rejected
	const d2 = m.process(m.newLimitOrder(2, BUY, 10, 5));
	expect(d2.order.seq).toBe(2);
});

test("seq: stop-limit receives seq when processed", () => {
	m.process(m.newStopLimitOrder(1, BUY, 15, 15, 5));
	expect(m.order(1).seq).toBe(1);
});

test("seq: maker trade entry carries its original seq", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	const done = m.process(m.newLimitOrder(2, SELL, 10, 5));
	const maker = done.trades.find((t) => t.id === 1);
	expect(maker.seq).toBe(1);
	expect(done.order.seq).toBe(2);
});

test("timestamp: assigned to recent unix-ms on process", () => {
	const before = Date.now();
	const done = m.process(m.newLimitOrder(1, BUY, 10, 5));
	const after = Date.now();
	expect(done.order.timestamp).toBeGreaterThanOrEqual(before);
	expect(done.order.timestamp).toBeLessThanOrEqual(after);
});

// ---------------------------------------------------------------------------
// order() and cancel()
// ---------------------------------------------------------------------------

test("order(): finds resting limit order", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	expect(m.order(1)).toBeTruthy();
});

test("order(): finds stop-limit order", () => {
	m.process(m.newStopLimitOrder(1, BUY, 15, 15, 5));
	expect(m.order(1)).toBeTruthy();
});

test("order(): returns false for unknown id", () => {
	expect(m.order(99)).toBeFalsy();
});

test("cancel(): limit buy — removed from book, volume cleared", () => {
	const o = m.newLimitOrder(1, BUY, 10, 100);
	m.process(o);
	expect(m.orderBook.volume.getVolume(o)).toBe(100);
	expect(m.cancel(1)).toBe(true);
	expect(m.orderBook.volume.getVolume(o)).toBe(0);
	expect(m.order(1)).toBeFalsy();
});

test("cancel(): limit sell — removed from book, volume cleared", () => {
	const o = m.newLimitOrder(1, SELL, 10, 50);
	m.process(o);
	expect(m.cancel(1)).toBe(true);
	expect(m.order(1)).toBeFalsy();
});

test("cancel(): stop-limit — removed from stop book", () => {
	m.process(m.newStopLimitOrder(1, BUY, 9, 10, 100));
	expect(m.cancel(1)).toBe(true);
	expect(m.stopBook.find(1)).toBeFalsy();
	expect(m.stopBook.isEmpty()).toBe(true);
});

test("cancel(): non-existent id returns false", () => {
	expect(m.cancel("fake")).toBe(false);
	expect(m.cancel(99)).toBe(false);
});

// ---------------------------------------------------------------------------
// Order book: duplicate prevention
// ---------------------------------------------------------------------------

test("orderbook: second process with same id is ignored", () => {
	m.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));
	m.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));

	const raw = m.orderBook.getRaw()[TestSymbol];
	const queue = Object.values(raw.BUY)[0];
	expect(queue.length).toBe(1);
});

// ---------------------------------------------------------------------------
// Done result shape
// ---------------------------------------------------------------------------

test("done shape: resting limit — no trades, correct fields", () => {
	const done = m.process(m.newLimitOrder(1, BUY, 100, 10));
	expect(done.order.id).toBe(1);
	expect(done.order.isQuote).toBe(false);
	expect(done.trades).toEqual([]);
	expect(done.processed).toBe(0);
	expect(done.left).toBe(0);
	expect(done.canceled).toEqual([]);
	expect(done.activated).toEqual([]);
	expect(done.activations).toEqual([]);
});

test("done shape: filled limit — trades contain taker then maker", () => {
	m.process(m.newLimitOrder(2, SELL, 10, 5));
	const done = m.process(m.newLimitOrder(1, BUY, 10, 5));
	expect(done.trades.length).toBe(2);
	expect(done.trades[0].id).toBe(1); // taker
	expect(done.trades[1].id).toBe(2); // maker
	expect(done.processed).toBe(5);
	expect(done.left).toBe(0);
});

test("done shape: quote market — isQuote flag on taker entry", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 10));
	const done = m.process(m.newMarketBuyQuoteOrder(2, 50));
	expect(done.order.isQuote).toBe(true);
	expect(done.trades[0].isQuote).toBe(true);
	expect(done.trades[1].isQuote).toBe(false);
});

// ---------------------------------------------------------------------------
// Volume.hasEnough
// ---------------------------------------------------------------------------

test("volume: hasEnough SELL — price-filtered running sum", () => {
	const vol = new Volume(TestSymbol);
	vol.increase(createTestPriceOrder(1, LIMIT, SELL, 11, 11), 11, 11);
	vol.increase(createTestPriceOrder(2, LIMIT, SELL, 12, 12), 12, 12);
	vol.increase(createTestPriceOrder(3, LIMIT, SELL, 13, 13), 13, 13);

	expect(vol.hasEnough(SELL, 14, 36)).toBe(true);
	expect(vol.hasEnough(SELL, 12, 23)).toBe(true);
	expect(vol.hasEnough(SELL, 12, 24)).toBe(false); // price-13 excluded
	expect(vol.hasEnough(SELL, 10, 1)).toBe(false); // price-11+ excluded
});

test("volume: hasEnough BUY — price-filtered running sum", () => {
	const vol = new Volume(TestSymbol);
	vol.increase(createTestPriceOrder(1, LIMIT, BUY, 11, 11), 11, 11);
	vol.increase(createTestPriceOrder(2, LIMIT, BUY, 12, 12), 12, 12);
	vol.increase(createTestPriceOrder(3, LIMIT, BUY, 13, 13), 13, 13);

	expect(vol.hasEnough(BUY, 11, 36)).toBe(true);
	expect(vol.hasEnough(BUY, 12, 25)).toBe(true);
	expect(vol.hasEnough(BUY, 12, 26)).toBe(false); // price-11 excluded
	expect(vol.hasEnough(BUY, 14, 1)).toBe(false); // nothing at or above 14
});

// ---------------------------------------------------------------------------
// PriceComparator edge cases
// ---------------------------------------------------------------------------

test("comparator: market vs market throws", () => {
	const c = new PriceComparator();
	const mkt = createTestPriceOrder(1, MARKET, SELL, 0, 10);
	expect(() => c.compare(mkt, mkt)).toThrow();
});

test("comparator: unknown order type returns undefined", () => {
	const c = new PriceComparator();
	const lim = createTestPriceOrder(1, LIMIT, SELL, 10, 10);
	const fake = createTestPriceOrder(2, MARKET, BUY, 0, 10);
	fake.type = "fake";
	expect(c.compare(lim, fake)).toBeUndefined();
});

test("comparator: limit vs limit — taker price below maker returns 0 (no cross)", () => {
	const c = new PriceComparator();
	const buy = createTestPriceOrder(1, LIMIT, BUY, 10, 10);
	const ask = createTestPriceOrder(2, LIMIT, BUY, 11, 10);
	expect(c._getLimitLimitPrice(buy, ask)).toBe(0);
});

test("comparator: limit vs limit — taker price at or above maker returns maker price", () => {
	const c = new PriceComparator();
	const buy = createTestPriceOrder(1, LIMIT, BUY, 11, 10);
	const ask = createTestPriceOrder(2, LIMIT, BUY, 10, 10);
	expect(c._getLimitLimitPrice(buy, ask)).toBe(10);
});
