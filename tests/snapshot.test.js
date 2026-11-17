/**
 * Dump/restore (snapshot) rules:
 * state round-trips correctly, seq is preserved, old state is cleared.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

test("empty engine produces empty snapshot", () => {
	expect(m.dump()).toEqual({ v: 1, seq: 0, l: [], s: [] });
});

test("resting limit orders survive round-trip", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.process(m.newLimitOrder(2, SELL, 101, 5));
	m.process(m.newLimitOrder(3, BUY, 99, 7));

	const snap = m.dump();
	expect(snap.l).toHaveLength(3);
	expect(snap.s).toHaveLength(0);
	expect(snap.seq).toBe(3);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);

	const done = m2.process(m2.newLimitOrder(4, BUY, 100, 3));
	expect(done.trades).toHaveLength(2);
	expect(done.trades[1].price).toBe(100);
});

test("stop-limit orders survive round-trip and activate correctly", () => {
	m.process(m.newStopLimitOrder(10, BUY, 110, 111, 5));
	m.process(m.newStopLimitOrder(11, SELL, 90, 89, 3));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	// trigger BUY stop: sell maker at 110, then buy taker crosses it
	m2.process(m2.newLimitOrder(20, SELL, 110, 10));
	const done = m2.process(m2.newLimitOrder(21, BUY, 115, 10));
	expect(done.activations).toHaveLength(1);
});

test("partial fill is preserved correctly", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.process(m.newLimitOrder(2, BUY, 100, 4)); // order 1: open_amount=6

	const snap = m.dump();
	const [, , , amount, open_amount] = snap.l[0];
	expect(amount).toBe(10);
	expect(open_amount).toBe(6);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);
	const done = m2.process(m2.newLimitOrder(3, BUY, 100, 6));
	expect(done.trades[1].amount).toBe(6);
});

test("postOnly flag preserved", () => {
	m.process(m.newPostOnlyLimitOrder(1, BUY, 100, 10));
	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());
	expect(m2.order(1).postOnly).toBe(true);
});

test("iceberg fields preserved", () => {
	m.process(m.newIcebergOrder(1, BUY, 100, 30, 10));
	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());
	const o = m2.order(1);
	expect(o.peakAmount).toBe(10);
	expect(o.open_amount).toBe(10);
	expect(o.amount).toBe(30);
});

test("OCO link preserved in snapshot data", () => {
	m = new Matchingo(TestSymbol, DecimalScales);
	const lim = m.newLimitOrder(1, SELL, 1.1, 10);
	const stop = m.newStopLimitOrder(2, SELL, 0.9, 0.85, 10);
	lim.setOCO(2);
	stop.setOCO(1);
	m.process(lim);
	m.process(stop);

	const snap = m.dump();
	expect(snap.l[0][6]).toBe(2); // oco field on limit
	expect(snap.s[0][6]).toBe(1); // oco field on stop

	const m2 = new Matchingo(TestSymbol, DecimalScales);
	m2.restore(snap);
	expect(m2.dump()).toEqual(snap);
});

test("seq is preserved — next order increments from saved seq", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 5));
	m.process(m.newLimitOrder(2, SELL, 101, 5));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump()); // seq=2

	const done = m2.process(m2.newLimitOrder(3, BUY, 100, 5));
	expect(done.order.seq).toBe(3);
});

test("restore clears previous state", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	const snap = m.dump();

	m.process(m.newLimitOrder(2, SELL, 200, 5));
	m.restore(snap);

	expect(m.order(1)).toBeTruthy();
	expect(m.order(2)).toBeFalsy();
});

test("unsupported version throws", () => {
	expect(() => m.restore({ v: 99, seq: 0, l: [], s: [] })).toThrow();
});
