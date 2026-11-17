import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

test("bestBid: empty book returns null", () => {
	expect(m.bestBid()).toBeNull();
});

test("bestAsk: empty book returns null", () => {
	expect(m.bestAsk()).toBeNull();
});

test("level: missing price returns null", () => {
	expect(m.level(BUY, 100)).toBeNull();
});

test("bestBid: returns highest buy price", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	m.process(m.newLimitOrder(2, BUY, 12, 3));
	m.process(m.newLimitOrder(3, BUY, 11, 7));
	expect(m.bestBid()).toEqual({ price: 12, amount: 3 });
});

test("bestAsk: returns lowest sell price", () => {
	m.process(m.newLimitOrder(1, SELL, 20, 5));
	m.process(m.newLimitOrder(2, SELL, 18, 4));
	m.process(m.newLimitOrder(3, SELL, 22, 2));
	expect(m.bestAsk()).toEqual({ price: 18, amount: 4 });
});

test("level: returns total amount at that price", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	m.process(m.newLimitOrder(2, BUY, 10, 3));
	expect(m.level(BUY, 10)).toEqual({ price: 10, amount: 8 });
});

test("level: sell side", () => {
	m.process(m.newLimitOrder(1, SELL, 15, 6));
	expect(m.level(SELL, 15)).toEqual({ price: 15, amount: 6 });
	expect(m.level(SELL, 16)).toBeNull();
});

test("bestBid/bestAsk update after a trade", () => {
	m.process(m.newLimitOrder(1, BUY, 10, 5));
	m.process(m.newLimitOrder(2, SELL, 10, 5));
	expect(m.bestBid()).toBeNull();
	expect(m.bestAsk()).toBeNull();
});

test("bestBid updates after cancel", () => {
	m.process(m.newLimitOrder(1, BUY, 12, 1));
	m.process(m.newLimitOrder(2, BUY, 10, 1));
	expect(m.bestBid()).toEqual({ price: 12, amount: 1 });
	m.cancel(1);
	expect(m.bestBid()).toEqual({ price: 10, amount: 1 });
});

test("decimal scales are applied to book queries", () => {
	const md = new Matchingo(TestSymbol, DecimalScales);
	md.process(md.newLimitOrder(1, BUY, "9.500", "2.000"));
	md.process(md.newLimitOrder(2, SELL, "10.000", "1.500"));
	expect(md.bestBid()).toEqual({ price: 9.5, amount: 2 });
	expect(md.bestAsk()).toEqual({ price: 10, amount: 1.5 });
	expect(md.level(BUY, "9.500")).toEqual({ price: 9.5, amount: 2 });
});
