/**
 * Dump/restore (snapshot) rules:
 * state round-trips correctly, seq is preserved, old state is cleared.
 */

import { BUY, SELL } from "../src/constants.js";
import { ErrorCode } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

test("empty engine produces empty snapshot", () => {
	expect(m.dump()).toEqual({
		v: 2,
		seq: 0,
		tradeId: 0,
		lsn: 0,
		halted: false,
		lastPrice: 0,
		orders: [],
		stops: [],
		oco: [],
	});
});

test("resting limit orders survive round-trip", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	m.submit(m.newLimitOrder(2, SELL, 101, 5));
	m.submit(m.newLimitOrder(3, BUY, 99, 7));

	const snap = m.dump();
	expect(snap.orders).toHaveLength(3);
	expect(snap.stops).toHaveLength(0);
	expect(snap.seq).toBe(3);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);

	const done = m2.submit(m2.newLimitOrder(4, BUY, 100, 3));
	expect(done.trades).toHaveLength(2);
	expect(done.trades[1].price).toBe(100);
});

test("stop-limit orders survive round-trip and activate correctly", () => {
	m.submit(m.newStopLimitOrder(10, BUY, 110, 111, 5));
	m.submit(m.newStopLimitOrder(11, SELL, 90, 89, 3));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	// trigger BUY stop: sell maker at 110, then buy taker crosses it
	m2.submit(m2.newLimitOrder(20, SELL, 110, 10));
	const done = m2.submit(m2.newLimitOrder(21, BUY, 115, 10));
	expect(done.activations).toHaveLength(1);
});

test("partial fill is preserved correctly", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	m.submit(m.newLimitOrder(2, BUY, 100, 4)); // order 1: open_amount=6

	const snap = m.dump();
	const { amount, open } = snap.orders[0];
	expect(amount).toBe(10);
	expect(open).toBe(6);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);
	const done = m2.submit(m2.newLimitOrder(3, BUY, 100, 6));
	expect(done.trades[1].amount).toBe(6);
});

test("postOnly flag preserved", () => {
	m.submit(m.newPostOnlyLimitOrder(1, BUY, 100, 10));
	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());
	expect(m2.order(1).postOnly).toBe(true);
});

test("iceberg fields preserved", () => {
	m.submit(m.newIcebergOrder(1, BUY, 100, 30, 10));
	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());
	const o = m2.order(1);
	expect(o.peak).toBe(10);
	expect(o.shown).toBe(10);
	expect(o.open).toBe(30);
	expect(o.amount).toBe(30);
});

test("OCO link preserved in snapshot data", () => {
	m = new Matchingo(TestSymbol, DecimalScales);
	const lim = m.newLimitOrder(1, SELL, 1.1, 10);
	const stop = m.newStopLimitOrder(2, SELL, 0.9, 0.85, 10);
	lim.setOCO(2);
	stop.setOCO(1);
	m.submit(lim);
	m.submit(stop);

	const snap = m.dump();
	expect(snap.orders[0].oco).toBe(2); // oco field on limit
	expect(snap.stops[0].oco).toBe(1); // oco field on stop

	const m2 = new Matchingo(TestSymbol, DecimalScales);
	m2.restore(snap);
	expect(m2.dump()).toEqual(snap);
});

test("seq is preserved — next order increments from saved seq", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 5));
	m.submit(m.newLimitOrder(2, SELL, 101, 5));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump()); // seq=2

	const done = m2.submit(m2.newLimitOrder(3, BUY, 100, 5));
	expect(done.order.seq).toBe(3);
});

test("trade id, halt flag and last trade price are preserved", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 5));
	m.submit(m.newMarketOrder(2, BUY, 5));
	m.halt();

	const snap = m.dump();
	expect(snap).toMatchObject({ tradeId: 1, halted: true, lastPrice: 100 });

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(snap);
	expect(m2.halted).toBe(true);
	m2.resume();
	m2.submit(m2.newLimitOrder(3, SELL, 100, 5));
	expect(m2.submit(m2.newMarketOrder(4, BUY, 5)).trades[1].tradeId).toBe(2);
});

test("restore does not change the breaker reference price", () => {
	m = new Matchingo(TestSymbol, { ...TestScales, circuitBreaker: 10 });
	m.submit(m.newLimitOrder(1, SELL, 100, 5));
	m.submit(m.newMarketOrder(2, BUY, 5));

	const m2 = new Matchingo(TestSymbol, { ...TestScales, circuitBreaker: 10 });
	m2.restore(m.dump());
	m2.submit(m2.newLimitOrder(3, SELL, 150, 5));
	m2.submit(m2.newMarketOrder(4, BUY, 5));
	expect(m2.halted).toBe(true);
});

test("expiry, stp, trail settings and creation time are preserved", () => {
	m = new Matchingo(TestSymbol, { ...TestScales, clock: () => 1000 });
	m.submit(m.newLimitOrder(1, BUY, 100, 5).setExpiry(5000).setSTP("t", 2));
	m.submit(m.newTrailingStopOrder(2, SELL, 90, 5, { percent: 2.5 }));

	const m2 = new Matchingo(TestSymbol, { ...TestScales, clock: () => 1000 });
	m2.restore(m.dump());

	expect(m2.order(1)).toMatchObject({
		expiry: 5000,
		traderID: "t",
		stp: 2,
		timestamp: 1000,
	});
	expect(m2.order(2)).toMatchObject({ trailPercent: 2.5, stop: 90 });
	expect(m2.dump()).toEqual(m.dump());
});

test("restore recomputes the next expiry", () => {
	m = new Matchingo(TestSymbol, { ...TestScales, clock: () => 1000 });
	m.submit(m.newLimitOrder(1, BUY, 100, 5).setExpiry(5000));

	const m2 = new Matchingo(TestSymbol, { ...TestScales, clock: () => 6000 });
	m2.restore(m.dump());
	expect(m2.submit(m2.newLimitOrder(2, BUY, 90, 1)).canceled).toEqual([1]);
});

test("trailing stops keep their creation order after restore", () => {
	m.submit(m.newTrailingStopOrder(1, SELL, 50, 1, { offset: 5 }));
	m.submit(m.newTrailingStopOrder(2, SELL, 60, 1, { offset: 5 }));
	m.submit(m.newTrailingStopOrder(3, SELL, 40, 1, { offset: 5 }));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());
	expect([...m2._trailing.keys()]).toEqual([1, 2, 3]);
});

test("restore clears previous state", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));
	const snap = m.dump();

	m.submit(m.newLimitOrder(2, SELL, 200, 5));
	m.restore(snap);

	expect(m.order(1)).toBeTruthy();
	expect(m.order(2)).toBeFalsy();
});

test("unsupported version throws", () => {
	expect(() => m.restore({ v: 99 })).toThrow(
		expect.objectContaining({ code: ErrorCode.INVALID_SNAPSHOT }),
	);
	expect(() => m.restore({ v: 1, seq: 0, l: [], s: [] })).toThrow();
});
