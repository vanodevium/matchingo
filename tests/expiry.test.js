/**
 * Good-till-date: expiry timestamps and TTL, lazy purge before new orders,
 * explicit expire().
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;
let now;
let reads;

beforeEach(() => {
	now = 1000;
	reads = 0;
	m = new Matchingo(TestSymbol, {
		...TestScales,
		emitter: true,
		clock: () => {
			reads++;
			return now;
		},
	});
});

test("an order with an expiry rests until the clock reaches it", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5).setExpiry(2000));
	now = 1999;
	expect(m.submit(m.newLimitOrder(2, BUY, 9, 1)).canceled).toEqual([]);
	expect(m.order(1)).toBeTruthy();
});

test("expiry <= now cancels it before the next order is processed", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5).setExpiry(2000));
	now = 2000;
	const done = m.submit(m.newLimitOrder(2, SELL, 10, 5));
	expect(done.canceled).toEqual([1]);
	expect(done.trades).toEqual([]); // the expired order did not trade
	expect(m.order(1)).toBeNull();
	expect(m.bestBid()).toBeNull();
});

test("TTL is added to the clock at acceptance", () => {
	now = 1000;
	const done = m.submit(m.newLimitOrder(1, BUY, 10, 5).setTTL(500));
	expect(done.order.expiry).toBe(1500);
	expect(done.order.tif).toBe(Matchingo.GTD);
	now = 1500;
	expect(m.submit(m.newLimitOrder(2, BUY, 9, 1)).canceled).toEqual([1]);
});

test("expired orders are canceled in expiry order, ties by ID", () => {
	m.submit(m.newLimitOrder(3, BUY, 10, 1).setExpiry(3000));
	m.submit(m.newLimitOrder(2, BUY, 10, 1).setExpiry(2000));
	m.submit(m.newLimitOrder(5, BUY, 10, 1).setExpiry(2000));
	m.submit(m.newLimitOrder(1, BUY, 10, 1).setExpiry(9000));
	now = 5000;
	const done = m.submit(m.newLimitOrder(9, BUY, 1, 1));
	expect(done.canceled).toEqual([2, 5, 3]);
	expect(m.order(1)).toBeTruthy();
});

test("the earliest expiry is recomputed after a purge", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 1).setExpiry(2000));
	m.submit(m.newLimitOrder(2, BUY, 10, 1).setExpiry(4000));
	now = 3000;
	expect(m.submit(m.newLimitOrder(3, BUY, 9, 1)).canceled).toEqual([1]);
	now = 4000;
	expect(m.submit(m.newLimitOrder(4, BUY, 9, 1)).canceled).toEqual([2]);

	// nothing expires any more: a stamped order needs no clock read
	reads = 0;
	const order = m.newLimitOrder(5, BUY, 9, 1);
	order.timestamp = 1;
	m.submit(order);
	expect(reads).toBe(0);
});

test("dormant stops expire too", () => {
	m.submit(m.newStopLimitOrder(1, BUY, 20, 21, 5).setExpiry(2000));
	now = 2000;
	expect(m.submit(m.newLimitOrder(2, BUY, 9, 1)).canceled).toEqual([1]);
	expect(m.stopBook.find(1)).toBeFalsy();
});

test("a stop-limit keeps its expiry when it activates", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newStopLimitOrder(2, BUY, 10, 5, 1).setExpiry(4000));
	m.submit(m.newMarketOrder(3, BUY, 1));
	expect(m.order(2)).toMatchObject({ type: Matchingo.LIMIT, expiry: 4000 });
});

test("expire(): cancels everything due on an idle book", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 1).setExpiry(2000));
	m.submit(m.newLimitOrder(2, BUY, 10, 1).setExpiry(3000));
	expect(m.expire(2500)).toEqual([1]);
	expect(m.order(1)).toBeNull();
	expect(m.order(2)).toBeTruthy();
	expect(m.expire(3000)).toEqual([2]);
});

test("expire(): works while halted and without an argument uses the clock", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 1).setExpiry(2000));
	m.halt();
	now = 2000;
	expect(m.expire()).toEqual([1]);
});

test("expiry cancels emit cancel events", () => {
	const ids = [];
	m.emitter.on("canceled", ({ id }) => ids.push(id));
	m.submit(m.newLimitOrder(1, BUY, 10, 1).setExpiry(2000));
	m.expire(2000);
	expect(ids).toEqual([1]);
});

test("a book without expiring orders does not read the clock for purging", () => {
	const order = m.newLimitOrder(1, BUY, 10, 1);
	order.timestamp = 5;
	m.submit(order);
	expect(reads).toBe(0);
});
