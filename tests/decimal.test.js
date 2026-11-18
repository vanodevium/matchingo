/**
 * Decimal math utilities (toInt/fromInt/quoteOf/baseOf)
 * and engine-level input validation.
 */

import { BUY, SELL } from "../src/constants.js";
import { baseOf, fromInt, quoteOf, toInt } from "../src/decimal.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestSymbol } from "./constants.js";

// ---------------------------------------------------------------------------
// toInt / fromInt
// ---------------------------------------------------------------------------

test("toInt: parses numbers and strings", () => {
	expect(toInt(10.111, 3)).toBe(10111);
	expect(toInt("10.111", 3)).toBe(10111);
	expect(toInt("10.1", 3)).toBe(10100);
	expect(toInt(10, 2)).toBe(1000);
	expect(toInt("0.10", 1)).toBe(1);
	expect(toInt(1e-7, 8)).toBe(10);
});

test("toInt: rejects too many fractional digits", () => {
	expect(() => toInt(10.1111, 3)).toThrow("too many digits");
	expect(() => toInt("0.0001", 3)).toThrow("too many digits");
	expect(() => toInt(1.5e-10, 8)).toThrow();
	expect(() => toInt(0.30000000000000004, 3)).toThrow("too many digits");
});

test("toInt: rejects invalid values", () => {
	expect(() => toInt(-1, 2)).toThrow("invalid decimal");
	expect(() => toInt("abc", 2)).toThrow("invalid decimal");
	expect(() => toInt(NaN, 2)).toThrow("invalid decimal");
	expect(() => toInt(Infinity, 2)).toThrow("invalid decimal");
	expect(() => toInt(2 ** 53, 0)).toThrow("too big");
});

test("fromInt: converts integer back to decimal", () => {
	expect(fromInt(10111, 3)).toBe(10.111);
	expect(fromInt(7, 0)).toBe(7);
});

// ---------------------------------------------------------------------------
// Quote math
// ---------------------------------------------------------------------------

test("quoteOf / baseOf round-trip", () => {
	expect(quoteOf(10939, 7780, 1000)).toBe(85106);
	expect(baseOf(85109, 7780, 1000)).toBe(10939);
	expect(baseOf(1, 2000, 1000)).toBe(0); // below one base unit
});

// ---------------------------------------------------------------------------
// Engine input validation
// ---------------------------------------------------------------------------

test("engine: zero or negative values rejected", () => {
	const m = new Matchingo(TestSymbol, DecimalScales);
	expect(() => m.newLimitOrder(1, BUY, 10, 0)).toThrow("greater than zero");
	expect(() => m.newLimitOrder(1, BUY, 0, 1)).toThrow("greater than zero");
	expect(() => m.newMarketOrder(1, BUY, 0)).toThrow("greater than zero");
	expect(() => m.newStopLimitOrder(1, BUY, 0, 1, 1)).toThrow(
		"greater than zero",
	);
	expect(() => m.newLimitOrder(1, BUY, -1, 1)).toThrow("invalid");
});

test("engine: too many decimal digits rejected", () => {
	const m = new Matchingo(TestSymbol, DecimalScales);
	expect(() => m.newLimitOrder(1, BUY, 10, 0.0001)).toThrow("too many");
});

test("engine: price * amount overflow rejected", () => {
	const m = new Matchingo(TestSymbol, DecimalScales);
	expect(() => m.newLimitOrder(1, BUY, 5e9, 5e9)).toThrow("too big");
});

// ---------------------------------------------------------------------------
// Decimal engine integration
// ---------------------------------------------------------------------------

describe("decimal engine", () => {
	let m;
	beforeEach(() => {
		m = new Matchingo(TestSymbol, { ...DecimalScales, emitter: true });
	});

	const bookEmpty = () => {
		const depth = m.depth()[TestSymbol];
		return (
			Object.keys(depth[BUY]).length + Object.keys(depth[SELL]).length === 0
		);
	};

	test("0.1 + 0.2 = 0.3 leaves no residue after full fill", () => {
		m.submit(m.newLimitOrder(1, BUY, 10, 0.1));
		m.submit(m.newLimitOrder(2, BUY, 10, 0.2));
		expect(m.depth()[TestSymbol][BUY]).toStrictEqual({ 10: 0.3 });
		m.submit(m.newMarketOrder(3, SELL, 0.3));
		expect(bookEmpty()).toBe(true);
	});

	test("1000 small market trades leave a clean book", () => {
		m.submit(m.newLimitOrder(1, SELL, 10, 100));
		for (let i = 0; i < 1000; i++) {
			m.submit(m.newMarketOrder(10 + i, BUY, 0.1));
		}
		expect(bookEmpty()).toBe(true);
		expect(m.order(1)).toBeNull();
	});

	test("equal prices share one depth level", () => {
		expect(() => m.newLimitOrder(1, BUY, 0.1 + 0.2, 1)).toThrow("too many");
		m.submit(m.newLimitOrder(2, BUY, "0.3", 1));
		m.submit(m.newLimitOrder(3, BUY, 0.3, 1));
		expect(m.depth()[TestSymbol][BUY]).toStrictEqual({ 0.3: 2 });
	});

	test("quote buy at sub-unit price", () => {
		m.submit(m.newLimitOrder(1, SELL, 0.7, 10));
		const r = m.submit(m.newMarketBuyQuoteOrder(2, 7));
		expect(r.processed).toBe(7);
		expect(r.left).toBe(0);
		expect(r.trades.map((t) => t.amount)).toStrictEqual([7, 10]);
		expect(bookEmpty()).toBe(true);
	});

	test("quote buy: dust never overspends budget", () => {
		m.submit(m.newLimitOrder(1, SELL, 3, 10));
		const r = m.submit(m.newMarketBuyQuoteOrder(2, 10));
		expect(r.trades[1].amount).toBe(3.333);
		expect(r.processed).toBe(9.999);
		expect(r.left).toBe(0.001);
		expect(r.canceled).toStrictEqual([2]);
	});

	test("trade results and volume events use decimal values", () => {
		const events = [];
		m.emitter.on("volume", ({ symbol: _s, ...data }) => events.push(data));
		m.submit(m.newLimitOrder(1, BUY, 10.111, 1.5));
		const r = m.submit(m.newMarketOrder(2, SELL, 1.5));
		expect(r.trades.map((t) => [t.price, t.amount])).toStrictEqual([
			[0, 1.5],
			[10.111, 1.5],
		]);
		expect(events[0]).toMatchObject({ side: BUY, price: 10.111, volume: 1.5 });
	});
});
