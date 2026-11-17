import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, false, TestScales);
});

test("modify: returns false for unknown id", () => {
	expect(m.modify(99, 100, 10)).toBe(false);
});

test("modify: in-place amount decrease keeps time priority", () => {
	const a = m.newLimitOrder(1, SELL, 100, 10);
	const b = m.newLimitOrder(2, SELL, 100, 10);
	m.process(a);
	m.process(b);

	// Reduce order 1 from 10 to 6
	expect(m.modify(1, 100, 6)).toBe(true);

	// Order 1 is still ahead of order 2 — a buy for 6 should fill order 1
	const buy = m.newLimitOrder(3, BUY, 100, 6);
	const done = m.process(buy);

	// trades[0] = taker (order 3), trades[1] = maker (order 1)
	expect(done.trades.length).toBe(2);
	expect(done.trades[1].id).toBe(1);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy();
});

test("modify: amount decrease updates volume", () => {
	const a = m.newLimitOrder(1, SELL, 100, 10);
	m.process(a);

	m.modify(1, 100, 4);

	const order = m.order(1);
	expect(order.open_amount).toBe(4);
	expect(order.amount).toBe(4);

	const ask = m.bestAsk();
	expect(ask.amount).toBe(4);
});

test("modify: price change re-queues (loses time priority)", () => {
	const a = m.newLimitOrder(1, SELL, 100, 10);
	const b = m.newLimitOrder(2, SELL, 101, 10);
	m.process(a);
	m.process(b);

	// Move order 1 to price 102 — it should now be behind order 2 at 101
	const done = m.modify(1, 102, 10);
	expect(done).toBeTruthy();
	expect(m.order(1)).not.toBeNull();

	const buy = m.newLimitOrder(3, BUY, 101, 10);
	const result = m.process(buy);

	// trades[0] = taker (order 3), trades[1] = maker (order 2)
	expect(result.trades.length).toBe(2);
	expect(result.trades[1].id).toBe(2);
	expect(m.order(2)).toBeFalsy();
	expect(m.order(1)).toBeTruthy();
});

test("modify: amount increase re-queues (loses time priority)", () => {
	const a = m.newLimitOrder(1, SELL, 100, 5);
	const b = m.newLimitOrder(2, SELL, 100, 5);
	m.process(a);
	m.process(b);

	// Increase order 1 — it goes to the back
	m.modify(1, 100, 10);

	const buy = m.newLimitOrder(3, BUY, 100, 5);
	const result = m.process(buy);

	// trades[0] = taker (order 3), trades[1] = first maker
	expect(result.trades[1].id).toBe(2);
	expect(m.order(1)).toBeTruthy();
});

test("modify: re-queued order can match immediately", () => {
	const bid = m.newLimitOrder(1, BUY, 100, 10);
	const ask = m.newLimitOrder(2, SELL, 110, 10);
	m.process(bid);
	m.process(ask);

	// Lower the ask to cross with the bid
	const done = m.modify(2, 100, 10);

	// trades[0] = taker (order 2 modified), trades[1] = maker (order 1)
	expect(done.trades.length).toBe(2);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeFalsy();
});
