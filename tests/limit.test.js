/**
 * Limit order matching rules:
 * price-time priority, full fill, partial fill, resting remainder,
 * volume tracking, multi-level sweep, maker price used.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

// ---------------------------------------------------------------------------
// Resting (no match)
// ---------------------------------------------------------------------------

test("limit buy rests in book when no asks", () => {
	const done = m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(done.trades).toEqual([]);
	expect(done.processed).toBe(0);
	expect(m.order(1)).toBeTruthy();
	expect(m.orderBook.volume.get(BUY)).toBe(5);
});

test("limit sell rests in book when no bids", () => {
	const done = m.submit(m.newLimitOrder(1, SELL, 10, 5));
	expect(done.trades).toEqual([]);
	expect(m.order(1)).toBeTruthy();
	expect(m.orderBook.volume.get(SELL)).toBe(5);
});

test("limit buy does not cross when ask is above limit", () => {
	m.submit(m.newLimitOrder(1, SELL, 11, 5));
	const done = m.submit(m.newLimitOrder(2, BUY, 10, 5));
	expect(done.trades).toEqual([]);
	expect(m.order(2)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Full fill
// ---------------------------------------------------------------------------

test("limit buy fully fills matching sell", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 5));
	const done = m.submit(m.newLimitOrder(2, BUY, 10, 5));

	expect(done.trades.length).toBe(2);
	expect(done.processed).toBe(5);
	expect(done.left).toBe(0);
	expect(done.canceled).toEqual([]);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeFalsy();
	expect(m.orderBook.volume.get(SELL)).toBe(0);
	expect(m.orderBook.volume.get(BUY)).toBe(0);
});

test("limit sell fully fills matching buys", () => {
	m.submit(m.newLimitOrder(1, BUY, 13, 13));
	m.submit(m.newLimitOrder(2, BUY, 12, 12));
	m.submit(m.newLimitOrder(3, BUY, 11, 11));

	const done = m.submit(m.newLimitOrder(4, SELL, 10, 36));

	expect(done.trades.length).toBe(4);
	// best bid first (13), then 12, then 11
	expect(done.trades[1].price).toBe(13);
	expect(done.trades[1].amount).toBe(13);
	expect(done.trades[2].price).toBe(12);
	expect(done.trades[3].price).toBe(11);
	expect(done.processed).toBe(36);
	expect(m.orderBook.volume.get(BUY)).toBe(0);
});

test("limit buy fully fills multiple asks in price order", () => {
	m.submit(m.newLimitOrder(1, SELL, 11, 11));
	m.submit(m.newLimitOrder(2, SELL, 12, 12));
	m.submit(m.newLimitOrder(3, SELL, 13, 13));

	const done = m.submit(m.newLimitOrder(4, BUY, 13, 36));

	expect(done.trades.length).toBe(4);
	// best ask first (11), then 12, then 13
	expect(done.trades[1].price).toBe(11);
	expect(done.trades[2].price).toBe(12);
	expect(done.trades[3].price).toBe(13);
	expect(done.processed).toBe(36);
	expect(m.orderBook.volume.get(SELL)).toBe(0);
});

// ---------------------------------------------------------------------------
// Partial fill
// ---------------------------------------------------------------------------

test("limit buy: more than available — remainder rests in book", () => {
	m.submit(m.newLimitOrder(1, SELL, 11, 11));
	m.submit(m.newLimitOrder(2, SELL, 12, 12));
	m.submit(m.newLimitOrder(3, SELL, 13, 13));

	const done = m.submit(m.newLimitOrder(4, BUY, 13, 40));

	expect(done.processed).toBe(36);
	expect(done.left).toBe(4);
	expect(m.order(4)).toBeTruthy(); // resting remainder
	expect(m.orderBook.volume.get(BUY)).toBe(4);
	expect(m.orderBook.volume.get(SELL)).toBe(0);
});

test("limit buy: less than available — drains partially, leaves maker", () => {
	m.submit(m.newLimitOrder(1, SELL, 11, 11));
	m.submit(m.newLimitOrder(2, SELL, 12, 12));
	m.submit(m.newLimitOrder(3, SELL, 13, 13));

	const done = m.submit(m.newLimitOrder(4, BUY, 13, 24));

	expect(done.processed).toBe(24);
	expect(done.left).toBe(0);
	// order 3 (price 13) partially filled: 13 → 12 filled → 1 remains
	expect(done.trades[3].amount).toBe(1);
	expect(m.order(3).open).toBe(12);
	expect(m.orderBook.volume.get(SELL)).toBe(12);
});

// ---------------------------------------------------------------------------
// Maker price used in trades
// ---------------------------------------------------------------------------

test("trade price: maker entry uses maker price, taker entry uses taker limit price", () => {
	// A limit taker's trade entry carries the order's own price (not 0).
	// Only market order takers show price=0 (because market orders have price=0).
	m.submit(m.newLimitOrder(1, SELL, 10, 5)); // ask at 10
	const done = m.submit(m.newLimitOrder(2, BUY, 15, 5)); // willing to pay 15

	expect(done.trades[0].price).toBe(15); // limit taker: own price
	expect(done.trades[1].price).toBe(10); // maker: ask price
});

test("market taker trade entry has price=0", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 5));
	const done = m.submit(m.newMarketOrder(2, BUY, 5));
	expect(done.trades[0].price).toBe(0); // market taker
	expect(done.trades[1].price).toBe(10); // maker
});

// ---------------------------------------------------------------------------
// Volume tracking
// ---------------------------------------------------------------------------

test("volume decreases after trade", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 10));
	m.submit(m.newLimitOrder(2, BUY, 10, 4));
	expect(m.orderBook.volume.get(SELL)).toBe(6);
	expect(m.orderBook.volume.get(BUY)).toBe(0);
});

test("volume decreases after cancel", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 10));
	expect(m.orderBook.volume.get(BUY)).toBe(10);
	m.cancel(1);
	expect(m.orderBook.volume.get(BUY)).toBe(0);
});
