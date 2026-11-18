/**
 * Self-trade prevention: the mode of the incoming (taker) order decides
 * what happens when it meets a resting order of the same participant.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

const {
	STP_CANCEL_NEWEST,
	STP_CANCEL_OLDEST,
	STP_CANCEL_BOTH,
	STP_DECREMENT,
	STP_NONE,
} = Matchingo;

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, emitter: true });
});

const own = (order, mode = STP_NONE) => order.setSTP("trader", mode);

test("none: a self-trade is allowed", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 5)));
	const done = m.submit(own(m.newLimitOrder(2, BUY, 10, 5), STP_NONE));
	expect(done.processed).toBe(5);
});

test("different participants trade normally", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 5).setSTP("a", STP_CANCEL_NEWEST));
	const done = m.submit(
		m.newLimitOrder(2, BUY, 10, 5).setSTP("b", STP_CANCEL_NEWEST),
	);
	expect(done.processed).toBe(5);
});

test("cancel newest: the incoming remainder is canceled, the resting order stays", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 3));
	m.submit(own(m.newLimitOrder(2, SELL, 10, 3)));
	m.submit(m.newLimitOrder(3, SELL, 10, 3));

	const done = m.submit(own(m.newLimitOrder(4, BUY, 10, 9), STP_CANCEL_NEWEST));

	expect(done.processed).toBe(3); // earlier trades stay valid
	expect(done.trades.map((t) => t.id)).toEqual([4, 1]);
	expect(done.canceled).toEqual([4]);
	expect(done.stored).toBe(false);
	expect(m.order(2)).toBeTruthy();
	expect(m.order(3)).toBeTruthy();
});

test("cancel oldest: the resting order is canceled, matching goes on", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 3)));
	m.submit(m.newLimitOrder(2, SELL, 10, 3));

	const done = m.submit(own(m.newLimitOrder(3, BUY, 10, 3), STP_CANCEL_OLDEST));

	expect(done.canceled).toEqual([1]);
	expect(done.trades.map((t) => t.id)).toEqual([3, 2]);
	expect(done.processed).toBe(3);
	expect(m.order(1)).toBeNull();
});

test("cancel oldest: the incoming order rests when nothing else matches", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 3)));
	const done = m.submit(own(m.newLimitOrder(2, BUY, 10, 3), STP_CANCEL_OLDEST));
	expect(done.canceled).toEqual([1]);
	expect(done.stored).toBe(true);
});

test("cancel both: both are canceled", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 3)));
	m.submit(m.newLimitOrder(2, SELL, 10, 3));

	const done = m.submit(own(m.newLimitOrder(3, BUY, 10, 3), STP_CANCEL_BOTH));

	expect(done.canceled).toEqual([1, 3]);
	expect(done.trades).toEqual([]);
	expect(m.order(2)).toBeTruthy();
	expect(m.order(3)).toBeNull();
});

test("decrement: both are reduced without a trade", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 5)));

	const done = m.submit(own(m.newLimitOrder(2, BUY, 10, 3), STP_DECREMENT));

	expect(done.trades).toEqual([]);
	expect(done.processed).toBe(0);
	expect(m.order(1).open).toBe(2);
	expect(m.bestAsk()).toEqual({ price: 10, amount: 2 });
	expect(m.order(2)).toBeNull(); // the incoming order is fully consumed
});

test("decrement: a fully consumed resting order is canceled", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 2)));
	m.submit(m.newLimitOrder(2, SELL, 10, 5));

	const done = m.submit(own(m.newLimitOrder(3, BUY, 10, 4), STP_DECREMENT));

	// order 1 is canceled; order 3 lost 2 to the decrement, so 2 are left
	expect(done.canceled).toEqual([1, 3]);
	expect(done.trades.map((t) => [t.id, t.amount])).toEqual([
		[3, 2],
		[2, 2],
	]);
	expect(done.left).toBe(2);
	expect(m.order(2).open).toBe(3);
});

test("decrement: the incoming order that is fully consumed ends", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 5)));
	const done = m.submit(own(m.newMarketOrder(2, BUY, 3), STP_DECREMENT));
	expect(done.trades).toEqual([]);
	expect(done.left).toBe(3);
	expect(m.order(1).open).toBe(2);
});

test("decrement on a market-quote order falls back to cancel newest", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 5)));
	const done = m.submit(own(m.newMarketBuyQuoteOrder(2, 50), STP_DECREMENT));
	expect(done.canceled).toEqual([2]);
	expect(m.order(1).open).toBe(5);
});

test("the mode of the taker decides, not the resting order's", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 3), STP_CANCEL_BOTH));
	const done = m.submit(own(m.newLimitOrder(2, BUY, 10, 3), STP_NONE));
	expect(done.processed).toBe(3);
});

test("a market order obeys stp too", () => {
	m.submit(own(m.newLimitOrder(1, SELL, 10, 3)));
	m.submit(m.newLimitOrder(2, SELL, 11, 3));
	const done = m.submit(own(m.newMarketOrder(3, BUY, 6), STP_CANCEL_OLDEST));
	expect(done.canceled).toEqual([1, 3]);
	expect(done.processed).toBe(3);
});

test("canceled orders produce cancel events", () => {
	const ids = [];
	m.emitter.on("canceled", ({ id }) => ids.push(id));
	m.submit(own(m.newLimitOrder(1, SELL, 10, 3)));
	m.submit(own(m.newLimitOrder(2, BUY, 10, 3), STP_CANCEL_BOTH));
	expect(ids).toEqual([1, 2]);
});

test("iceberg: decrement takes the visible slice, then the refill", () => {
	m.submit(own(m.newIcebergOrder(1, SELL, 10, 10, 4)));
	const done = m.submit(own(m.newLimitOrder(2, BUY, 10, 6), STP_DECREMENT));
	expect(done.trades).toEqual([]);
	expect(m.order(1)).toMatchObject({ open: 4, shown: 2 });
	expect(m.bestAsk()).toEqual({ price: 10, amount: 2 });
});
