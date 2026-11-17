import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

test("dump: empty engine produces empty snapshot", () => {
	const snap = m.dump();
	expect(snap).toEqual({ v: 1, seq: 0, l: [], s: [] });
});

test("dump/restore: resting limit orders survive round-trip", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	m.process(m.newLimitOrder(2, SELL, 101, 5));
	m.process(m.newLimitOrder(3, BUY, 99, 7));

	const snap = m.dump();
	expect(snap.l).toHaveLength(3);
	expect(snap.s).toHaveLength(0);
	expect(snap.seq).toBe(3);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);

	// seq is preserved — next order gets seq 4
	const o = m2.newLimitOrder(4, BUY, 100, 3);
	const result = m2.process(o);
	// trades[0] is the taker, trades[1] is the maker
	expect(result.trades).toHaveLength(2);
	expect(result.trades[1].price).toBe(100);
	expect(result.trades[1].amount).toBe(3);
});

test("dump/restore: stop-limit orders survive round-trip", () => {
	m.process(m.newStopLimitOrder(10, BUY, 110, 111, 5));
	m.process(m.newStopLimitOrder(11, SELL, 90, 89, 3));

	const snap = m.dump();
	expect(snap.s).toHaveLength(2);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);

	// BUY stop fires at tradePrice >= 110 — place SELL@110 maker, BUY@115 taker
	m2.process(m2.newLimitOrder(20, SELL, 110, 10));
	const result = m2.process(m2.newLimitOrder(21, BUY, 115, 10));
	const activated = result.activations;
	expect(activated).toHaveLength(1);
});

test("dump/restore: partial fill is preserved", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	// partially fill it: buy 4 of 10
	m.process(m.newLimitOrder(2, BUY, 100, 4));

	const snap = m.dump();
	// order 1 is still open with open_amount=6
	expect(snap.l).toHaveLength(1);
	const [, , , amount, open_amount] = snap.l[0];
	expect(amount).toBe(10);
	expect(open_amount).toBe(6);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);

	const result = m2.process(m2.newLimitOrder(3, BUY, 100, 6));
	expect(result.trades).toHaveLength(2);
	expect(result.trades[1].amount).toBe(6);
});

test("dump/restore: OCO link is preserved", () => {
	m = new Matchingo(TestSymbol, DecimalScales);
	const lim = m.newLimitOrder(1, SELL, 1.1, 10);
	const stop = m.newStopLimitOrder(2, SELL, 0.9, 0.85, 10);
	lim.setOCO(2);
	stop.setOCO(1);
	m.process(lim);
	m.process(stop);

	const snap = m.dump();
	expect(snap.l[0][6]).toBe(2); // oco field
	expect(snap.s[0][6]).toBe(1);

	const m2 = new Matchingo(TestSymbol, DecimalScales);
	m2.restore(snap);
	const snap2 = m2.dump();
	expect(snap2).toEqual(snap);
});

test("restore: clears previous state", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));
	const snap = m.dump();

	m.process(m.newLimitOrder(2, SELL, 200, 5));
	m.restore(snap);

	// only order 1 should be in the book
	expect(m.order(1)).toBeTruthy();
	expect(m.order(2)).toBeFalsy();
});

test("restore: unsupported version throws", () => {
	expect(() => m.restore({ v: 99, seq: 0, l: [], s: [] })).toThrow();
});
