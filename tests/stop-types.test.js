/**
 * Stop-market and trailing stop orders; stop ordering rules.
 */

import { BUY, SELL } from "../src/constants.js";
import { ErrorCode } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, emitter: true });
});

// ---------------------------------------------------------------------------
// Stop-market
// ---------------------------------------------------------------------------

test("stop-market: becomes a market order when triggered", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 50, 5));
	m.submit(m.newStopMarketOrder(3, BUY, 10, 3));

	const done = m.submit(m.newMarketOrder(4, BUY, 1));
	expect(done.activated).toEqual([3]);
	const activation = done.activations[0];
	expect(activation.order.id).toBe(3);
	expect(activation.trades.map((t) => [t.id, t.price, t.amount])).toEqual([
		[3, 0, 3],
		[2, 50, 3],
	]);
	expect(m.order(3)).toBeNull();
});

test("stop-market: finding no liquidity, it is canceled", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newStopMarketOrder(2, BUY, 10, 3));
	const done = m.submit(m.newMarketOrder(3, BUY, 1));
	expect(done.activations[0].canceled).toEqual([2]);
	expect(done.activations[0].stored).toBe(false);
	expect(m.order(2)).toBeNull();
});

test("stop-limit: finding no liquidity, it rests as a limit order", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newStopLimitOrder(2, BUY, 10, 9, 3));
	const done = m.submit(m.newMarketOrder(3, BUY, 1));
	expect(done.activations[0].stored).toBe(true);
	expect(m.bestBid()).toEqual({ price: 9, amount: 3 });
});

test("stop: a time in force applies once it activates", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 12, 1));
	m.submit(m.newStopLimitOrder(3, BUY, 10, 9, 3).setTIF(Matchingo.IOC));
	const done = m.submit(m.newMarketOrder(4, BUY, 1));
	expect(done.activations[0].canceled).toEqual([3]);
	expect(m.bestBid()).toBeNull();
});

test("stop: submitting never triggers it, even beyond the last trade", () => {
	m.submit(m.newLimitOrder(1, SELL, 20, 1));
	m.submit(m.newMarketOrder(2, BUY, 1)); // last trade 20
	const done = m.submit(m.newStopMarketOrder(3, BUY, 10, 1));
	expect(done.stored).toBe(true);
	expect(done.activated).toEqual([]);
	expect(m.stopBook.find(3)).toBeTruthy();
});

test("stop: activation order is by side, then price, then arrival", () => {
	m.submit(m.newStopMarketOrder(1, SELL, 12, 1));
	m.submit(m.newStopMarketOrder(2, SELL, 14, 1));
	m.submit(m.newStopMarketOrder(3, BUY, 12, 1));
	m.submit(m.newStopMarketOrder(4, BUY, 11, 1));
	m.submit(m.newStopMarketOrder(5, BUY, 12, 1));
	m.submit(m.newLimitOrder(6, SELL, 13, 1));

	const done = m.submit(m.newMarketOrder(7, BUY, 1));
	expect(done.activated).toEqual([4, 3, 5, 2]);
	expect(done.activations.map((a) => a.order.id)).toEqual([4, 3, 5, 2]);
});

// ---------------------------------------------------------------------------
// Trailing stop
// ---------------------------------------------------------------------------

const trade = (price) => {
	const id = `t${Math.random()}`;
	m.submit(m.newLimitOrder(`s${id}`, SELL, price, 1));
	return m.submit(m.newMarketOrder(`b${id}`, BUY, 1));
};

test("trailing SELL: the stop ratchets up and never down", () => {
	m.submit(m.newTrailingStopOrder(1, SELL, 90, 1, { offset: 5 }));
	trade(100);
	expect(m.order(1).stop).toBe(95);
	trade(110);
	expect(m.order(1).stop).toBe(105);
	trade(106); // candidate 101 is lower: the stop stays
	expect(m.order(1).stop).toBe(105);
});

test("trailing BUY: the stop ratchets down and never up", () => {
	m.submit(m.newTrailingStopOrder(1, BUY, 200, 1, { offset: 5 }));
	trade(100);
	expect(m.order(1).stop).toBe(105);
	trade(90);
	expect(m.order(1).stop).toBe(95);
	trade(94); // candidate 99 is higher: the stop stays
	expect(m.order(1).stop).toBe(95);
});

test("trailing: a percentage of the trade price", () => {
	m.submit(m.newTrailingStopOrder(1, SELL, 50, 1, { percent: 10 }));
	trade(200);
	expect(m.order(1).stop).toBe(180);
	trade(300);
	expect(m.order(1).stop).toBe(270);
});

test("trailing: the adjustment happens before the activation check", () => {
	// stop 95 would not fire at 100 from 90; after trailing it is 95
	m.submit(m.newTrailingStopOrder(1, SELL, 99, 1, { offset: 10 }));
	m.submit(m.newLimitOrder(2, BUY, 50, 5));
	const done = trade(100);
	// trade at 100: candidate 90 is not above 99, so the stop stays at 99
	expect(m.order(1).stop).toBe(99);
	expect(done.activated).toEqual([]);

	const down = m.submit(m.newMarketOrder(3, SELL, 1)); // trades at 50
	expect(down.activated).toEqual([1]);
});

test("trailing: a moved stop goes to the back of its new level", () => {
	m.submit(m.newStopMarketOrder(2, SELL, 95, 1));
	m.submit(m.newTrailingStopOrder(1, SELL, 90, 1, { offset: 5 }));
	trade(100);
	const level = m.stopBook.getOrders(TestSymbol, 95).map((o) => o.id);
	expect(level).toEqual([2, 1]);
});

test("trailing: several trailing stops move in creation order", () => {
	m.submit(m.newTrailingStopOrder(1, SELL, 1, 1, { offset: 5 }));
	m.submit(m.newTrailingStopOrder(2, SELL, 1, 1, { offset: 5 }));
	trade(100);
	expect(m.stopBook.getOrders(TestSymbol, 95).map((o) => o.id)).toEqual([1, 2]);
});

test("trailing: once activated it is a plain market order", () => {
	m.submit(m.newLimitOrder(10, BUY, 60, 5));
	m.submit(m.newTrailingStopOrder(1, SELL, 90, 2, { offset: 5 }));
	trade(100); // stop 95
	m.submit(m.newLimitOrder(11, BUY, 94, 1));
	m.submit(m.newLimitOrder(12, SELL, 95, 1));
	const done = m.submit(m.newMarketOrder(13, BUY, 1)); // trade at 95: fires
	expect(done.activated).toEqual([1]);
	expect(m._trailing.size).toBe(0);
	expect(done.activations[0].order.type).toBe(Matchingo.MARKET);
});

test("trailing: percent must be strictly between 0 and 100", () => {
	for (const percent of [0, 100, -1, 250, "5"]) {
		expect(() => m.newTrailingStopOrder(1, SELL, 90, 1, { percent })).toThrow(
			expect.objectContaining({ code: ErrorCode.INVALID_PRICE }),
		);
	}
	expect(() =>
		m.newTrailingStopOrder(1, SELL, 90, 1, { percent: 99.9 }),
	).not.toThrow();
});

test("trailing: needs exactly one of offset and percent", () => {
	expect(() => m.newTrailingStopOrder(1, SELL, 90, 1, {})).toThrow();
	expect(() =>
		m.newTrailingStopOrder(1, SELL, 90, 1, { offset: 1, percent: 1 }),
	).toThrow();
});

test("trailing: a canceled trailing stop is not adjusted", () => {
	m.submit(m.newTrailingStopOrder(1, SELL, 90, 1, { offset: 5 }));
	m.cancel(1);
	trade(100);
	expect(m._trailing.size).toBe(0);
});

test("trailing with decimals", () => {
	m = new Matchingo(TestSymbol, DecimalScales);
	m.submit(m.newTrailingStopOrder(1, SELL, 9, 1, { offset: "0.25" }));
	m.submit(m.newLimitOrder(2, SELL, 10.5, 1));
	m.submit(m.newMarketOrder(3, BUY, 1));
	expect(m.order(1).stop).toBe(10.25);
});
