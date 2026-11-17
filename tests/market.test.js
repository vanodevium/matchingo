/**
 * Market order matching rules:
 * base and quote modes, buy and sell sides,
 * full fill, partial fill, empty book behavior.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

// ---------------------------------------------------------------------------
// Market base — buy
// ---------------------------------------------------------------------------

test("market buy base: empty book — canceled with no trades", () => {
	const done = m.process(m.newMarketOrder(1, BUY, 10));
	expect(done.trades).toEqual([]);
	expect(done.processed).toBe(0);
	expect(done.canceled).toContain(1);
});

test("market buy base: fully filled", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 10));
	const done = m.process(m.newMarketOrder(2, BUY, 10));
	expect(done.processed).toBe(10);
	expect(done.left).toBe(0);
	expect(done.canceled).toEqual([]);
});

test("market buy base: partial fill — remainder canceled", () => {
	m.process(m.newLimitOrder(1, SELL, 10, 5));
	const done = m.process(m.newMarketOrder(2, BUY, 10));
	expect(done.processed).toBe(5);
	expect(done.canceled).toContain(2);
});

test("market buy base: sweeps multiple price levels in ask order", () => {
	m.process(m.newLimitOrder(1, SELL, 11, 5));
	m.process(m.newLimitOrder(2, SELL, 12, 5));
	m.process(m.newLimitOrder(3, SELL, 13, 5));
	const done = m.process(m.newMarketOrder(4, BUY, 15));
	expect(done.processed).toBe(15);
	expect(done.trades.length).toBe(4); // taker + 3 makers
});

// ---------------------------------------------------------------------------
// Market base — sell
// ---------------------------------------------------------------------------

test("market sell base: empty book — canceled with no trades", () => {
	const done = m.process(m.newMarketOrder(1, SELL, 10));
	expect(done.trades).toEqual([]);
	expect(done.canceled).toContain(1);
});

test("market sell base: fully filled", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 10));
	const done = m.process(m.newMarketOrder(2, SELL, 10));
	expect(done.processed).toBe(10);
	expect(done.canceled).toEqual([]);
});

test("market sell base: partial fill — remainder canceled", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 3));
	const done = m.process(m.newMarketOrder(2, SELL, 10));
	expect(done.processed).toBe(3);
	expect(done.canceled).toContain(2);
});

test("market sell base: sweeps multiple bid levels in bid order", () => {
	m.process(m.newLimitOrder(1, BUY, 13, 5));
	m.process(m.newLimitOrder(2, BUY, 12, 5));
	m.process(m.newLimitOrder(3, BUY, 11, 5));
	const done = m.process(m.newMarketOrder(4, SELL, 15));
	expect(done.processed).toBe(15);
	expect(done.trades.length).toBe(4);
});

// ---------------------------------------------------------------------------
// Market quote buy
// ---------------------------------------------------------------------------

test("market buy quote: empty book — no trades, no cancel entry", () => {
	// Quote mode: left=0 when no trades happen (calculateLeft never called).
	// The order is not canceled; it completes silently.
	const done = m.process(m.newMarketBuyQuoteOrder(1, 500));
	expect(done.trades).toEqual([]);
	expect(done.processed).toBe(0);
	expect(done.canceled).toEqual([]);
});

test("market buy quote: fully consumed", () => {
	m = new Matchingo(TestSymbol, { ...DecimalScales });
	m.process(m.newLimitOrder(1, SELL, 7.74, 13));
	m.process(m.newLimitOrder(2, SELL, 7.77, 11));
	m.process(m.newLimitOrder(3, SELL, 7.78, 12));

	const done = m.process(m.newMarketBuyQuoteOrder(4, 279.45));
	expect(done.processed).toBe(279.45);
	expect(done.left).toBe(0);
	expect(done.canceled).toEqual([]);
});

test("market buy quote: budget exceeds book — truncated and canceled", () => {
	m = new Matchingo(TestSymbol, { ...DecimalScales });
	m.process(m.newLimitOrder(1, SELL, 7.74, 13));
	m.process(m.newLimitOrder(2, SELL, 7.77, 11));
	m.process(m.newLimitOrder(3, SELL, 7.78, 12));

	const done = m.process(m.newMarketBuyQuoteOrder(4, 36 * 8)); // more than available
	expect(done.order.isQuote).toBe(true);
	expect(done.canceled.length).toBe(1);
	expect(done.left).toBeGreaterThan(0);
});

test("market buy quote: partial fill with dust remainder", () => {
	m = new Matchingo(TestSymbol, { ...DecimalScales });
	m.process(m.newLimitOrder(1, SELL, 7.74, 13));
	m.process(m.newLimitOrder(2, SELL, 7.77, 11));
	m.process(m.newLimitOrder(3, SELL, 7.78, 12));

	// 271.199 → last trade buys fractional base; 0.003 of budget is dust
	const done = m.process(m.newMarketBuyQuoteOrder(4, 271.199));
	expect(done.processed).toBe(271.196);
	expect(done.left).toBe(0.003);
	expect(done.canceled).toContain(4);
});

// ---------------------------------------------------------------------------
// Market quote sell
// ---------------------------------------------------------------------------

test("market sell quote: empty book — no trades, no cancel entry", () => {
	const done = m.process(m.newMarketSellQuoteOrder(1, 500));
	expect(done.trades).toEqual([]);
	expect(done.processed).toBe(0);
	expect(done.canceled).toEqual([]);
});

test("market sell quote: partial fill — bids exhausted, remainder canceled", () => {
	m.process(m.newLimitOrder(1, BUY, 50, 10));
	m.process(m.newLimitOrder(2, BUY, 49, 5));

	const o = m.newMarketSellQuoteOrder(3, 1000); // more than 50*10+49*5=745
	o.setQuoteMode();
	const done = m.process(o);

	expect(done.trades.length).toBeGreaterThan(0);
	expect(done.processed).toBeLessThan(1000);
	expect(done.canceled).toContain(3);
});

test("market sell quote: fully consumed", () => {
	m = new Matchingo(TestSymbol, { ...DecimalScales });
	m.process(m.newLimitOrder(1, BUY, 7.78, 12));
	m.process(m.newLimitOrder(2, BUY, 7.77, 11));
	m.process(m.newLimitOrder(3, BUY, 7.74, 13));

	const o = m.newMarketSellQuoteOrder(4, 280);
	o.setQuoteMode();
	const done = m.process(o);
	expect(done.processed).toBe(279.45);
	expect(done.left).toBe(0.55);
	expect(done.canceled.length).toBe(1);
});
