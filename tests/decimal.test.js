import { BUY, SELL } from "../src/constants.js";
import { baseOf, fromInt, quoteOf, toInt } from "../src/decimal.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestSymbol } from "./constants.js";

test("decimal: parse numbers and strings", () => {
	expect(toInt(10.111, 3)).toBe(10111);
	expect(toInt("10.111", 3)).toBe(10111);
	expect(toInt("10.1", 3)).toBe(10100);
	expect(toInt(10, 2)).toBe(1000);
	expect(toInt("0.10", 1)).toBe(1);
	expect(toInt(1e-7, 8)).toBe(10);
});

test("decimal: reject too many digits", () => {
	expect(() => toInt(10.1111, 3)).toThrow("too many digits");
	expect(() => toInt("0.0001", 3)).toThrow("too many digits");
	expect(() => toInt(1.5e-10, 8)).toThrow();
	expect(() => toInt(0.30000000000000004, 3)).toThrow("too many digits");
});

test("decimal: reject bad values", () => {
	expect(() => toInt(-1, 2)).toThrow("invalid decimal");
	expect(() => toInt("abc", 2)).toThrow("invalid decimal");
	expect(() => toInt(NaN, 2)).toThrow("invalid decimal");
	expect(() => toInt(Infinity, 2)).toThrow("invalid decimal");
	expect(() => toInt(2 ** 53, 0)).toThrow("too big");
});

test("decimal: convert back and quote math", () => {
	expect(fromInt(10111, 3)).toBe(10.111);
	expect(fromInt(7, 0)).toBe(7);
	expect(quoteOf(10939, 7780, 1000)).toBe(85106);
	expect(baseOf(85109, 7780, 1000)).toBe(10939);
	expect(baseOf(1, 2000, 1000)).toBe(0);
});

test("matchingo: scales are required", () => {
	expect(() => new Matchingo(TestSymbol)).toThrow("priceScale");
	expect(() => new Matchingo(TestSymbol, false, { priceScale: 2 })).toThrow(
		"amountScale",
	);
	expect(
		() => new Matchingo(TestSymbol, false, { priceScale: -1, amountScale: 0 }),
	).toThrow("priceScale");
});

test("matchingo: decimalFrom", () => {
	expect(Matchingo.decimalFrom("1.25", 2)).toBe(125);
});

describe("decimal engine", () => {
	let m;
	beforeEach(() => {
		m = new Matchingo(TestSymbol, true, DecimalScales);
	});
	const empty = () => {
		const depth = m.depth()[TestSymbol];
		return Object.keys(depth[BUY]).length + Object.keys(depth[SELL]).length;
	};

	test("sum 0.1 + 0.2 leaves no volume residue", () => {
		m.process(m.newLimitOrder(1, BUY, 10, 0.1));
		m.process(m.newLimitOrder(2, BUY, 10, 0.2));
		expect(m.depth()[TestSymbol][BUY]).toStrictEqual({ 10: 0.3 });
		m.process(m.newMarketOrder(3, SELL, 0.3));
		expect(empty()).toBe(0);
	});

	test("1000 small trades leave a clean book", () => {
		m.process(m.newLimitOrder(1, SELL, 10, 100));
		for (let i = 0; i < 1000; i++) {
			m.process(m.newMarketOrder(10 + i, BUY, 0.1));
		}
		expect(empty()).toBe(0);
		expect(m.order(1)).toBe(false);
	});

	test("equal prices share one level", () => {
		expect(() => m.newLimitOrder(1, BUY, 0.1 + 0.2, 1)).toThrow("too many");
		m.process(m.newLimitOrder(2, BUY, "0.3", 1));
		m.process(m.newLimitOrder(3, BUY, 0.3, 1));
		expect(m.depth()[TestSymbol][BUY]).toStrictEqual({ 0.3: 2 });
	});

	test("quote buy at price below 1", () => {
		m.process(m.newLimitOrder(1, SELL, 0.7, 10));
		const r = m.process(m.newMarketBuyQuoteOrder(2, 7));
		expect(r.processed).toBe(7);
		expect(r.left).toBe(0);
		expect(r.trades.map((t) => t.amount)).toStrictEqual([7, 10]);
		expect(empty()).toBe(0);

		m.process(m.newLimitOrder(3, SELL, 0.1, 10));
		const r2 = m.process(m.newMarketBuyQuoteOrder(4, 0.3));
		expect(r2.processed).toBe(0.3);
		expect(r2.trades[1].amount).toBe(3);
	});

	test("quote buy keeps dust and never overspends", () => {
		m.process(m.newLimitOrder(1, SELL, 3, 10));
		const r = m.process(m.newMarketBuyQuoteOrder(2, 10));
		expect(r.trades[1].amount).toBe(3.333);
		expect(r.processed).toBe(9.999);
		expect(r.left).toBe(0.001);
		expect(r.canceled).toStrictEqual([2]);
	});

	test("input is validated", () => {
		expect(() => m.newLimitOrder(1, BUY, 10, 0)).toThrow("greater than zero");
		expect(() => m.newLimitOrder(1, BUY, 0, 1)).toThrow("greater than zero");
		expect(() => m.newLimitOrder(1, BUY, 10, 0.0001)).toThrow("too many");
		expect(() => m.newLimitOrder(1, BUY, -1, 1)).toThrow("invalid");
		expect(() => m.newLimitOrder(1, BUY, 5e9, 5e9)).toThrow("too big");
		expect(() => m.newMarketOrder(1, BUY, 0)).toThrow("greater than zero");
		expect(() => m.newStopLimitOrder(1, BUY, 0, 1, 1)).toThrow(
			"greater than zero",
		);
	});

	test("events and result use decimals", () => {
		const events = [];
		m.emitter.on(TestSymbol, (header, data) =>
			events.push([header.type, data]),
		);
		m.process(m.newLimitOrder(1, BUY, 10.111, 1.5));
		const r = m.process(m.newMarketOrder(2, SELL, 1.5));
		expect(r.trades.map((t) => [t.price, t.amount])).toStrictEqual([
			[0, 1.5],
			[10.111, 1.5],
		]);
		expect(events[0]).toStrictEqual([
			"volume",
			{ side: BUY, price: 10.111, volume: 1.5 },
		]);
	});
});
