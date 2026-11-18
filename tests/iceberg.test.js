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

test("validation: peak >= amount throws", () => {
	expect(() => m.newIcebergOrder(1, BUY, 100, 10, 10)).toThrow();
	expect(() => m.newIcebergOrder(1, BUY, 100, 10, 15)).toThrow();
});

test("shown starts at peak", () => {
	const o = m.newIcebergOrder(1, BUY, 100, 30, 10);
	expect(o.shown).toBe(10);
	expect(o.amount).toBe(30);
});

// ---------------------------------------------------------------------------
// Peak management (iceberg as maker)
// ---------------------------------------------------------------------------

test("partial fill within peak — peak reduced, order stays in book", () => {
	m.submit(m.newIcebergOrder(1, BUY, 100, 30, 10));
	m.submit(m.newLimitOrder(2, SELL, 100, 5));
	expect(m.order(1).shown).toBe(5);
});

test("full peak exhausted — refills to next peak, still in book", () => {
	m.submit(m.newIcebergOrder(1, BUY, 100, 30, 10));
	m.submit(m.newLimitOrder(2, SELL, 100, 10));
	expect(m.order(1).shown).toBe(10);
});

test("last peak is smaller than peak", () => {
	// amount=25, peak=10 → peaks: 10, 10, 5
	m.submit(m.newIcebergOrder(1, BUY, 100, 25, 10));
	m.submit(m.newLimitOrder(2, SELL, 100, 20)); // exhausts first two peaks
	expect(m.order(1).shown).toBe(5);
});

test("fully exhausted — removed from book", () => {
	m.submit(m.newIcebergOrder(1, BUY, 100, 20, 10));
	m.submit(m.newLimitOrder(2, SELL, 100, 20));
	expect(m.order(1)).toBeFalsy();
});

test("taker sweeps iceberg across multiple refills in one order", () => {
	m.submit(m.newIcebergOrder(1, BUY, 100, 30, 10));
	const done = m.submit(m.newLimitOrder(2, SELL, 100, 25));
	// taker summary + one entry per slice
	expect(done.trades.map((t) => [t.id, t.amount])).toEqual([
		[2, 25],
		[1, 10],
		[1, 10],
		[1, 5],
	]);
	expect(done.processed).toBe(25);
	expect(m.order(1).shown).toBe(5);
	expect(m.order(1).open).toBe(5);
});

test("time priority: regular order behind iceberg fills after peak exhausted", () => {
	m.submit(m.newIcebergOrder(1, BUY, 100, 20, 10));
	m.submit(m.newLimitOrder(3, BUY, 100, 10));

	// sell 15: 10 from ice peak → ice refills to back; 5 from reg
	m.submit(m.newLimitOrder(2, SELL, 100, 15));

	expect(m.order(1).shown).toBe(10); // refilled peak
	expect(m.order(3).shown).toBe(5); // partially filled
});

// ---------------------------------------------------------------------------
// Iceberg as taker with IOC / FOK
// ---------------------------------------------------------------------------

test("IOC iceberg taker: immediately canceled when no matching orders", () => {
	// IOC cancels remaining open after the matching pass.
	// peak=10 is the open; nothing to match → canceled.
	const ice = m.newIcebergOrder(1, BUY, 100, 30, 10);
	ice.tif = IOC;
	const done = m.submit(ice);
	expect(done.canceled).toContain(1);
	expect(m.order(1)).toBeFalsy();
});

test("IOC iceberg taker: fills available, cancels remainder", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 7));

	const ice = m.newIcebergOrder(2, BUY, 100, 30, 10);
	ice.tif = IOC;
	const done = m.submit(ice);

	expect(done.processed).toBe(7);
	expect(done.canceled).toContain(2);
	expect(m.order(2)).toBeFalsy();
});

test("FOK iceberg taker: canceled when volume insufficient for total amount", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 5)); // 5 < 30

	const ice = m.newIcebergOrder(2, BUY, 100, 30, 10);
	ice.tif = FOK;
	const done = m.submit(ice);

	expect(done.trades).toEqual([]);
	expect(done.canceled).toContain(2);
	expect(m.order(1)).toBeTruthy(); // resting ask untouched
});

test("FOK iceberg taker: the whole total is checked and filled", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 50));

	const ice = m.newIcebergOrder(2, BUY, 100, 30, 10);
	ice.tif = FOK;
	const done = m.submit(ice);

	expect(done.processed).toBe(30);
	expect(done.canceled).toEqual([]);
	expect(m.order(2)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test("iceberg persists through dump/restore", () => {
	m.submit(m.newIcebergOrder(1, BUY, 100, 30, 10));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	const restored = m2.order(1);
	expect(restored.peak).toBe(10);
	expect(restored.shown).toBe(10);
	expect(restored.open).toBe(30);
	expect(restored.amount).toBe(30);
});
