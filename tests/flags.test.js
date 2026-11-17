import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, false, TestScales);
});

// ---------------------------------------------------------------------------
// Post-only
// ---------------------------------------------------------------------------

test("post-only: rests when book is empty", () => {
	const o = m.newPostOnlyLimitOrder(1, BUY, 100, 10);
	const done = m.process(o);
	expect(done.canceled.length).toBe(0);
	expect(m.order(1)).toBeTruthy();
});

test("post-only: canceled when it would immediately match (buy crosses ask)", () => {
	const ask = m.newLimitOrder(2, SELL, 100, 10);
	m.process(ask);

	const po = m.newPostOnlyLimitOrder(1, BUY, 100, 5);
	const done = m.process(po);
	expect(done.canceled.length).toBe(1);
	expect(done.canceled[0]).toBe(1);
	expect(done.trades.length).toBe(0);
	expect(m.order(1)).toBeFalsy();
	// resting ask is untouched
	expect(m.order(2)).toBeTruthy();
});

test("post-only: canceled when it would immediately match (sell crosses bid)", () => {
	const bid = m.newLimitOrder(2, BUY, 100, 10);
	m.process(bid);

	const po = m.newPostOnlyLimitOrder(1, SELL, 100, 5);
	const done = m.process(po);
	expect(done.canceled.length).toBe(1);
	expect(done.canceled[0]).toBe(1);
	expect(done.trades.length).toBe(0);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy();
});

test("post-only: rests when price does not cross", () => {
	// ask is at 101, buy post-only is at 100 → no cross
	const ask = m.newLimitOrder(2, SELL, 101, 10);
	m.process(ask);

	const po = m.newPostOnlyLimitOrder(1, BUY, 100, 5);
	const done = m.process(po);
	expect(done.canceled.length).toBe(0);
	expect(m.order(1)).toBeTruthy();
});

test("post-only: persists through dump/restore", () => {
	const o = m.newPostOnlyLimitOrder(1, BUY, 100, 10);
	m.process(o);

	const snap = m.dump();
	const m2 = new Matchingo(TestSymbol, false, TestScales);
	m2.restore(snap);

	const restored = m2.order(1);
	expect(restored).toBeTruthy();
	expect(restored.postOnly).toBe(true);
});

// ---------------------------------------------------------------------------
// Iceberg
// ---------------------------------------------------------------------------

test("iceberg: validation rejects peakAmount >= amount", () => {
	expect(() => m.newIcebergOrder(1, BUY, 100, 10, 10)).toThrow();
	expect(() => m.newIcebergOrder(1, BUY, 100, 10, 15)).toThrow();
});

test("iceberg: open_amount starts at peakAmount", () => {
	const o = m.newIcebergOrder(1, BUY, 100, 30, 10);
	expect(o.open_amount).toBe(10);
	expect(o.amount).toBe(30);
});

test("iceberg: single fill within peak, remainder stays in book", () => {
	const ice = m.newIcebergOrder(1, BUY, 100, 30, 10);
	m.process(ice);

	// sell 5 against the iceberg peak
	const s = m.newLimitOrder(2, SELL, 100, 5);
	const done = m.process(s);
	expect(done.trades.length).toBe(2);
	expect(done.trades[1].id).toBe(1);

	// iceberg still in book, peak partially consumed
	const resting = m.order(1);
	expect(resting).toBeTruthy();
	expect(resting.open_amount).toBe(5); // 10 - 5
});

test("iceberg: full peak consumed triggers refill, still in book", () => {
	const ice = m.newIcebergOrder(1, BUY, 100, 30, 10);
	m.process(ice);

	// sell 10 — exhausts the first peak
	const s = m.newLimitOrder(2, SELL, 100, 10);
	m.process(s);

	const resting = m.order(1);
	expect(resting).toBeTruthy();
	expect(resting.open_amount).toBe(10); // refilled with second peak
});

test("iceberg: last peak is smaller than peakAmount", () => {
	// amount=25, peak=10 → peaks: 10, 10, 5
	const ice = m.newIcebergOrder(1, BUY, 100, 25, 10);
	m.process(ice);

	// sell 20 — exhausts first two peaks, refill with 5
	const s = m.newLimitOrder(2, SELL, 100, 20);
	m.process(s);

	const resting = m.order(1);
	expect(resting).toBeTruthy();
	expect(resting.open_amount).toBe(5);
});

test("iceberg: fully exhausted is removed from book", () => {
	const ice = m.newIcebergOrder(1, BUY, 100, 20, 10);
	m.process(ice);

	// sell 20 — clears all peaks
	const s = m.newLimitOrder(2, SELL, 100, 20);
	m.process(s);

	expect(m.order(1)).toBeFalsy();
});

test("iceberg: taker sweeps iceberg across multiple refills in one order", () => {
	const ice = m.newIcebergOrder(1, BUY, 100, 30, 10);
	m.process(ice);

	// sell 25 → sweeps peaks 10, 10, partial 5
	const s = m.newLimitOrder(2, SELL, 100, 25);
	const done = m.process(s);

	// trades[0] = taker, trades[1] = iceberg maker
	expect(done.trades.length).toBe(2);
	expect(done.trades[1].id).toBe(1);
	expect(done.processed).toBe(25);

	const resting = m.order(1);
	expect(resting).toBeTruthy();
	expect(resting.open_amount).toBe(5); // 30 - 25
});

test("iceberg: time priority — regular order behind iceberg fills after peak exhausted", () => {
	const ice = m.newIcebergOrder(1, BUY, 100, 20, 10);
	const reg = m.newLimitOrder(3, BUY, 100, 10);
	m.process(ice);
	m.process(reg);

	// sell 15 → 10 from ice peak, then 5 from reg (ice refills to back)
	const s = m.newLimitOrder(2, SELL, 100, 15);
	const _done = m.process(s);

	const iceResting = m.order(1);
	const regResting = m.order(3);

	// ice peak was consumed and refilled (10 open), reg was partially filled (5 left)
	expect(iceResting.open_amount).toBe(10);
	expect(regResting.open_amount).toBe(5);
});

test("iceberg: persists through dump/restore", () => {
	const o = m.newIcebergOrder(1, BUY, 100, 30, 10);
	m.process(o);

	const snap = m.dump();
	const m2 = new Matchingo(TestSymbol, false, TestScales);
	m2.restore(snap);

	const restored = m2.order(1);
	expect(restored).toBeTruthy();
	expect(restored.peakAmount).toBe(10);
	expect(restored.open_amount).toBe(10);
	expect(restored.amount).toBe(30);
});
