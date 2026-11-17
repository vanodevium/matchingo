/**
 * Iceberg order rules:
 * peak visibility, refill on exhaustion, time priority after refill,
 * and behavior when used as a taker with IOC/FOK.
 */

import { BUY, FOK, IOC, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("validation: peakAmount >= amount throws", () => {
	expect(() => m.newIcebergOrder(1, BUY, 100, 10, 10)).toThrow();
	expect(() => m.newIcebergOrder(1, BUY, 100, 10, 15)).toThrow();
});

test("open_amount starts at peakAmount", () => {
	const o = m.newIcebergOrder(1, BUY, 100, 30, 10);
	expect(o.open_amount).toBe(10);
	expect(o.amount).toBe(30);
});

// ---------------------------------------------------------------------------
// Peak management (iceberg as maker)
// ---------------------------------------------------------------------------

test("partial fill within peak — peak reduced, order stays in book", () => {
	m.process(m.newIcebergOrder(1, BUY, 100, 30, 10));
	m.process(m.newLimitOrder(2, SELL, 100, 5));
	expect(m.order(1).open_amount).toBe(5);
});

test("full peak exhausted — refills to next peak, still in book", () => {
	m.process(m.newIcebergOrder(1, BUY, 100, 30, 10));
	m.process(m.newLimitOrder(2, SELL, 100, 10));
	expect(m.order(1).open_amount).toBe(10);
});

test("last peak is smaller than peakAmount", () => {
	// amount=25, peak=10 → peaks: 10, 10, 5
	m.process(m.newIcebergOrder(1, BUY, 100, 25, 10));
	m.process(m.newLimitOrder(2, SELL, 100, 20)); // exhausts first two peaks
	expect(m.order(1).open_amount).toBe(5);
});

test("fully exhausted — removed from book", () => {
	m.process(m.newIcebergOrder(1, BUY, 100, 20, 10));
	m.process(m.newLimitOrder(2, SELL, 100, 20));
	expect(m.order(1)).toBeFalsy();
});

test("taker sweeps iceberg across multiple refills in one order", () => {
	m.process(m.newIcebergOrder(1, BUY, 100, 30, 10));
	const done = m.process(m.newLimitOrder(2, SELL, 100, 25));
	expect(done.trades.length).toBe(2); // taker + iceberg maker (single entry)
	expect(done.trades[1].id).toBe(1);
	expect(done.processed).toBe(25);
	expect(m.order(1).open_amount).toBe(5);
});

test("time priority: regular order behind iceberg fills after peak exhausted", () => {
	m.process(m.newIcebergOrder(1, BUY, 100, 20, 10));
	m.process(m.newLimitOrder(3, BUY, 100, 10));

	// sell 15: 10 from ice peak → ice refills to back; 5 from reg
	m.process(m.newLimitOrder(2, SELL, 100, 15));

	expect(m.order(1).open_amount).toBe(10); // refilled peak
	expect(m.order(3).open_amount).toBe(5); // partially filled
});

// ---------------------------------------------------------------------------
// Iceberg as taker with IOC / FOK
// ---------------------------------------------------------------------------

test("IOC iceberg taker: immediately canceled when no matching orders", () => {
	// IOC cancels remaining open_amount after the matching pass.
	// peakAmount=10 is the open_amount; nothing to match → canceled.
	const ice = m.newIcebergOrder(1, BUY, 100, 30, 10);
	ice.tif = IOC;
	const done = m.process(ice);
	expect(done.canceled).toContain(1);
	expect(m.order(1)).toBeFalsy();
});

test("IOC iceberg taker: fills available, cancels remainder", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 7));

	const ice = m.newIcebergOrder(2, BUY, 100, 30, 10);
	ice.tif = IOC;
	const done = m.process(ice);

	expect(done.processed).toBe(7);
	expect(done.canceled).toContain(2);
	expect(m.order(2)).toBeFalsy();
});

test("FOK iceberg taker: canceled when volume insufficient for total amount", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 5)); // 5 < 30

	const ice = m.newIcebergOrder(2, BUY, 100, 30, 10);
	ice.tif = FOK;
	const done = m.process(ice);

	expect(done.trades).toEqual([]);
	expect(done.canceled).toContain(2);
	expect(m.order(1)).toBeTruthy(); // resting ask untouched
});

test("FOK iceberg taker: FOK checks total amount but only fills one peak", () => {
	// FOK volume check passes for order.amount=30 (50 available).
	// Matching uses open_amount=peak=10; the hidden 20 are silently dropped.
	m.process(m.newLimitOrder(1, SELL, 100, 50));

	const ice = m.newIcebergOrder(2, BUY, 100, 30, 10);
	ice.tif = FOK;
	const done = m.process(ice);

	expect(done.processed).toBe(10); // one peak
	expect(done.canceled).toEqual([]);
	expect(m.order(2)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test("iceberg persists through dump/restore", () => {
	m.process(m.newIcebergOrder(1, BUY, 100, 30, 10));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	const restored = m2.order(1);
	expect(restored.peakAmount).toBe(10);
	expect(restored.open_amount).toBe(10);
	expect(restored.amount).toBe(30);
});
