import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

test("first order gets seq 1", () => {
	const done = m.process(m.newLimitOrder(1, BUY, 10, 5));
	expect(done.order.seq).toBe(1);
});

test("seq increments for each process call", () => {
	const d1 = m.process(m.newLimitOrder(1, BUY, 10, 5));
	const d2 = m.process(m.newLimitOrder(2, BUY, 10, 5));
	const d3 = m.process(m.newLimitOrder(3, SELL, 10, 5));
	expect(d1.order.seq).toBe(1);
	expect(d2.order.seq).toBe(2);
	expect(d3.order.seq).toBe(3);
});

test("duplicate ID does not increment seq", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	const result = m.process(m.newLimitOrder(1, BUY, 10, 5));
	expect(result).toBe(false);
	const d3 = m.process(m.newLimitOrder(2, BUY, 10, 5));
	expect(d3.order.seq).toBe(2);
});

test("timestamp is a recent unix ms value", () => {
	const before = Date.now();
	const done = m.process(m.newLimitOrder(1, BUY, 10, 5));
	const after = Date.now();
	expect(done.order.timestamp).toBeGreaterThanOrEqual(before);
	expect(done.order.timestamp).toBeLessThanOrEqual(after);
});

test("stop-limit order gets seq when processed", () => {
	const done = m.process(m.newStopLimitOrder(1, BUY, 15, 15, 5));
	expect(done).toBe(true);
	const order = m.order(1);
	expect(order.seq).toBe(1);
	expect(typeof order.timestamp).toBe("number");
});

test("maker order in a trade carries its original seq", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	const done = m.process(m.newLimitOrder(2, SELL, 10, 5));
	const maker = done.trades.find((o) => o.id === 1);
	expect(maker.seq).toBe(1);
	expect(done.order.seq).toBe(2);
});
