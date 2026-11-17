/**
 * Time-In-Force rules: GTC (default), FOK, IOC.
 * Covers limit orders, market orders (always IOC), and stop-limit activation.
 */

import { BUY, FOK, IOC, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

// ---------------------------------------------------------------------------
// GTC (default) — rests until filled or canceled
// ---------------------------------------------------------------------------

test("GTC: unfilled limit rests in book", () => {
	const done = m.process(m.newLimitOrder(1, BUY, 10, 5));
	expect(done.canceled).toEqual([]);
	expect(m.order(1)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// FOK — Fill-or-Kill on limit orders
// ---------------------------------------------------------------------------

test("FOK limit: canceled when book has insufficient volume", () => {
	m.process(m.newLimitOrder(1, SELL, 11, 11));
	m.process(m.newLimitOrder(2, SELL, 12, 12));
	m.process(m.newLimitOrder(3, SELL, 13, 13)); // total 36, need 40

	const o = m.newLimitOrder(4, BUY, 13, 40);
	o.tif = FOK;
	const done = m.process(o);

	expect(done.trades).toEqual([]);
	expect(done.canceled).toContain(4);
	// book untouched
	expect(m.orderBook.volume.get(SELL)).toBe(36);
});

test("FOK limit: fills fully when book has enough", () => {
	m.process(m.newLimitOrder(1, SELL, 11, 11));
	m.process(m.newLimitOrder(2, SELL, 12, 12));
	m.process(m.newLimitOrder(3, SELL, 13, 13));

	const o = m.newLimitOrder(4, BUY, 13, 36);
	o.tif = FOK;
	const done = m.process(o);

	expect(done.processed).toBe(36);
	expect(done.canceled).toEqual([]);
	expect(m.orderBook.volume.get(SELL)).toBe(0);
});

// ---------------------------------------------------------------------------
// IOC — Immediate-or-Cancel on limit orders
// ---------------------------------------------------------------------------

test("IOC limit: fills partial match, cancels remainder", () => {
	m.process(m.newLimitOrder(1, SELL, 11, 11));
	m.process(m.newLimitOrder(2, SELL, 12, 12));
	m.process(m.newLimitOrder(3, SELL, 13, 13));

	const o = m.newLimitOrder(4, BUY, 13, 40);
	o.tif = IOC;
	const done = m.process(o);

	expect(done.processed).toBe(36);
	expect(done.left).toBe(4);
	expect(done.canceled).toContain(4);
	expect(m.orderBook.volume.get(SELL)).toBe(0);
	expect(m.orderBook.volume.get(BUY)).toBe(0); // not resting
});

test("IOC limit: fully filled — no cancel", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 10));
	const o = m.newLimitOrder(2, BUY, 10, 10);
	o.tif = IOC;
	const done = m.process(o);

	expect(done.processed).toBe(10);
	expect(done.canceled).toEqual([]);
});

test("IOC limit: no match — entire order canceled", () => {
	const o = m.newLimitOrder(1, BUY, 10, 5);
	o.tif = IOC;
	const done = m.process(o);

	expect(done.trades).toEqual([]);
	expect(done.canceled).toContain(1);
	expect(m.order(1)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Market orders always become IOC (FOK flag is overridden)
// ---------------------------------------------------------------------------

test("market: FOK flag is overridden to IOC — partial fill is kept", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 5)); // only 5 available; market wants 10

	const o = m.newMarketOrder(2, BUY, 10);
	o.tif = FOK; // ignored — becomes IOC
	const done = m.process(o);

	// IOC behavior: fills 5, cancels remainder
	expect(done.processed).toBe(5);
	expect(done.trades.length).toBe(2);
	expect(done.canceled).toContain(2);
});

// ---------------------------------------------------------------------------
// FOK and IOC on activated stop-limit orders
// ---------------------------------------------------------------------------

test("stop-limit FOK: fully canceled when activated with insufficient book", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 1));
	m.process(m.newLimitOrder(2, SELL, 11, 3)); // only 3 below limit 12; stop wants 5

	const stop = m.newStopLimitOrder(100, BUY, 10, 12, 5);
	stop.tif = FOK;
	m.process(stop);

	const result = m.process(m.newMarketOrder(3, BUY, 1));
	expect(result.activated).toContain(100);

	const activation = result.activations[0];
	expect(activation.trades).toEqual([]);
	expect(activation.processed).toBe(0);
	expect(activation.canceled).toContain(100);
	expect(m.order(100)).toBeFalsy();
	expect(m.order(2)).toBeTruthy(); // resting ask untouched
});

test("stop-limit FOK: fully fills when activated with sufficient book", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 1));
	m.process(m.newLimitOrder(2, SELL, 11, 10)); // 10 available

	const stop = m.newStopLimitOrder(100, BUY, 10, 12, 5);
	stop.tif = FOK;
	m.process(stop);

	const result = m.process(m.newMarketOrder(3, BUY, 1));
	const activation = result.activations[0];

	expect(activation.processed).toBe(5);
	expect(activation.canceled).toEqual([]);
	expect(m.order(100)).toBeFalsy();
});

test("stop-limit IOC: cancels remainder when activated with insufficient book", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 1));
	m.process(m.newLimitOrder(2, SELL, 11, 2)); // only 2 below limit 12; stop wants 10
	m.process(m.newLimitOrder(3, SELL, 15, 10)); // above limit — won't match

	const stop = m.newStopLimitOrder(100, BUY, 10, 12, 10);
	stop.tif = IOC;
	m.process(stop);

	const result = m.process(m.newMarketOrder(4, BUY, 1));
	const activation = result.activations[0];

	expect(activation.processed).toBe(2);
	expect(activation.canceled).toContain(100);
	expect(m.order(100)).toBeFalsy();
	expect(m.order(3)).toBeTruthy();
});

test("stop-limit IOC: no cancel when activated and fully fills", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 1));
	m.process(m.newLimitOrder(2, SELL, 11, 10)); // enough for the stop

	const stop = m.newStopLimitOrder(100, BUY, 10, 12, 5);
	stop.tif = IOC;
	m.process(stop);

	const result = m.process(m.newMarketOrder(3, BUY, 1));
	const activation = result.activations[0];

	expect(activation.processed).toBe(5);
	expect(activation.canceled).toEqual([]);
});
