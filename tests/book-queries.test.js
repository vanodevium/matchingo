/**
 * Book query API: bestBid, bestAsk, level, depth.
 * Covers empty states, updates after trades and cancels, decimal scaling.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

// ---------------------------------------------------------------------------
// bestBid
// ---------------------------------------------------------------------------

test("bestBid: empty book returns null", () => {
	expect(m.bestBid()).toBeNull();
});

test("bestBid: returns highest buy price", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.submit(m.newLimitOrder(2, BUY, 12, 3));
	m.submit(m.newLimitOrder(3, BUY, 11, 7));
	expect(m.bestBid()).toEqual({ price: 12, amount: 3 });
});

test("bestBid: updates after cancel", () => {
	m.submit(m.newLimitOrder(1, BUY, 12, 1));
	m.submit(m.newLimitOrder(2, BUY, 10, 1));
	m.cancel(1);
	expect(m.bestBid()).toEqual({ price: 10, amount: 1 });
});

test("bestBid: null after all bids filled", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.submit(m.newLimitOrder(2, SELL, 10, 5));
	expect(m.bestBid()).toBeNull();
});

// ---------------------------------------------------------------------------
// bestAsk
// ---------------------------------------------------------------------------

test("bestAsk: empty book returns null", () => {
	expect(m.bestAsk()).toBeNull();
});

test("bestAsk: returns lowest sell price", () => {
	m.submit(m.newLimitOrder(1, SELL, 20, 5));
	m.submit(m.newLimitOrder(2, SELL, 18, 4));
	m.submit(m.newLimitOrder(3, SELL, 22, 2));
	expect(m.bestAsk()).toEqual({ price: 18, amount: 4 });
});

test("bestAsk: null after all asks filled", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 5));
	m.submit(m.newLimitOrder(2, BUY, 10, 5));
	expect(m.bestAsk()).toBeNull();
});

// ---------------------------------------------------------------------------
// level
// ---------------------------------------------------------------------------

test("level: missing price returns null", () => {
	expect(m.level(BUY, 100)).toBeNull();
});

test("level: returns total amount at that price (aggregates orders)", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.submit(m.newLimitOrder(2, BUY, 10, 3));
	expect(m.level(BUY, 10)).toEqual({ price: 10, amount: 8 });
});

test("level: sell side, adjacent price returns null", () => {
	m.submit(m.newLimitOrder(1, SELL, 15, 6));
	expect(m.level(SELL, 15)).toEqual({ price: 15, amount: 6 });
	expect(m.level(SELL, 16)).toBeNull();
});

// ---------------------------------------------------------------------------
// depth
// ---------------------------------------------------------------------------

test("depth: returns both sides with all price levels", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.submit(m.newLimitOrder(2, SELL, 15, 3));
	const depth = m.depth()[TestSymbol];
	expect(depth[BUY][10]).toBe(5);
	expect(depth[SELL][15]).toBe(3);
});

// ---------------------------------------------------------------------------
// Decimal scale applied to output
// ---------------------------------------------------------------------------

test("decimal scales applied to bestBid/bestAsk/level", () => {
	const md = new Matchingo(TestSymbol, DecimalScales);
	md.submit(md.newLimitOrder(1, BUY, "9.500", "2.000"));
	md.submit(md.newLimitOrder(2, SELL, "10.000", "1.500"));
	expect(md.bestBid()).toEqual({ price: 9.5, amount: 2 });
	expect(md.bestAsk()).toEqual({ price: 10, amount: 1.5 });
	expect(md.level(BUY, "9.500")).toEqual({ price: 9.5, amount: 2 });
});

// ---------------------------------------------------------------------------
// estimate
// ---------------------------------------------------------------------------

describe("estimate", () => {
	test("BUY: cost of consuming the asks level by level", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		m.submit(m.newLimitOrder(2, SELL, 12, 5));
		expect(m.estimate(BUY, 2)).toBe(20);
		expect(m.estimate(BUY, 4)).toBe(44);
	});

	test("SELL: proceeds of consuming the bids", () => {
		m.submit(m.newLimitOrder(1, BUY, 10, 2));
		m.submit(m.newLimitOrder(2, BUY, 8, 5));
		expect(m.estimate(SELL, 3)).toBe(28);
	});

	test("the book does not change", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		m.estimate(BUY, 2);
		expect(m.bestAsk()).toEqual({ price: 10, amount: 2 });
	});

	test("fails when the book lacks volume", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 2));
		expect(() => m.estimate(BUY, 3)).toThrow(
			expect.objectContaining({ code: "INSUFFICIENT_VOLUME" }),
		);
		expect(() => m.estimate(SELL, 1)).toThrow(
			expect.objectContaining({ code: "INSUFFICIENT_VOLUME" }),
		);
	});

	test("dormant stops are not liquidity", () => {
		m.submit(m.newStopLimitOrder(1, SELL, 5, 4, 10));
		expect(() => m.estimate(BUY, 1)).toThrow();
	});

	test("hidden iceberg volume counts", () => {
		m.submit(m.newIcebergOrder(1, SELL, 10, 10, 2));
		expect(m.estimate(BUY, 10)).toBe(100);
	});

	test("decimals", () => {
		m = new Matchingo(TestSymbol, DecimalScales);
		m.submit(m.newLimitOrder(1, SELL, 0.7, 10));
		expect(m.estimate(BUY, 4.5)).toBe(3.15);
	});

	test("invalid side or amount", () => {
		expect(() => m.estimate(9, 1)).toThrow(
			expect.objectContaining({ code: "INVALID_SIDE" }),
		);
		expect(() => m.estimate(BUY, 0)).toThrow(
			expect.objectContaining({ code: "INVALID_QUANTITY" }),
		);
	});
});

// ---------------------------------------------------------------------------
// FOK with hidden liquidity
// ---------------------------------------------------------------------------

test("FOK counts the hidden volume of resting icebergs", () => {
	m.submit(m.newIcebergOrder(1, SELL, 10, 10, 2));
	const done = m.submit(m.newLimitOrder(2, BUY, 10, 10).setTIF(Matchingo.FOK));
	expect(done.processed).toBe(10);
	expect(done.canceled).toEqual([]);
});

test("sequence, walSeq, walError and depthJSON", () => {
	const book = new Matchingo(TestSymbol, TestScales);
	expect(book.sequence).toBe(0);
	book.submit(book.newLimitOrder(1, SELL, 10, 1));
	expect(book.sequence).toBe(1);
	expect(book.walSeq).toBe(0);
	expect(book.walError).toBeNull();
	expect(JSON.parse(book.depthJSON())).toEqual(book.depth());
});

test("setCircuitBreaker halts on a large move", () => {
	const book = new Matchingo(TestSymbol, TestScales);
	book.setCircuitBreaker(10);
	book.submit(book.newLimitOrder(1, SELL, 10, 1));
	book.submit(book.newLimitOrder(2, BUY, 10, 1));
	book.submit(book.newLimitOrder(3, SELL, 20, 1));
	book.submit(book.newLimitOrder(4, BUY, 20, 1));
	expect(book.halted).toBe(true);
	expect(() => book.setCircuitBreaker(-1)).toThrow();
});
