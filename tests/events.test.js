/**
 * The event stream: trade, volume, canceled, activated, bbo, depth, halt.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;
let events;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, emitter: true });
	events = [];
	for (const name of [
		"trade",
		"volume",
		"canceled",
		"activated",
		"bbo",
		"depth",
		"halt",
	]) {
		m.emitter.on(name, ({ symbol, ...data }) => {
			expect(symbol).toBe(TestSymbol);
			events.push([name, data]);
		});
	}
});

const of = (name) => events.filter(([n]) => n === name).map(([, d]) => d);

test("trade: one event per fill with ids, price, amount and sequence", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 2));
	m.submit(m.newLimitOrder(2, SELL, 11, 3));
	m.submit(m.newLimitOrder(3, BUY, 11, 4));

	expect(of("trade")).toEqual([
		{ tradeId: 1, makerId: 1, takerId: 3, price: 10, amount: 2, sequence: 3 },
		{ tradeId: 2, makerId: 2, takerId: 3, price: 11, amount: 2, sequence: 3 },
	]);
});

test("volume: every change of a level", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 5));
	m.submit(m.newLimitOrder(2, SELL, 10, 3));
	m.submit(m.newMarketOrder(3, BUY, 6));
	m.cancel(2);

	expect(of("volume").map((v) => v.volume)).toEqual([5, 8, 3, 2, 0]);
});

test("volume: iceberg refill", () => {
	m.submit(m.newIcebergOrder(1, SELL, 10, 8, 3));
	events.length = 0;
	m.submit(m.newMarketOrder(2, BUY, 3)); // slice filled, next slice posted
	expect(of("volume").map((v) => v.volume)).toEqual([0, 3]);
});

test("volume: modify in place", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 8));
	events.length = 0;
	m.modify(1, 10, 5);
	expect(of("volume").map((v) => v.volume)).toEqual([5]);
});

test("volume: self-trade decrement", () => {
	m.submit(m.newLimitOrder(1, SELL, 12, 5).setSTP("a", 0));
	events.length = 0;
	m.submit(m.newLimitOrder(2, BUY, 12, 3).setSTP("a", 4));
	expect(of("volume").map((v) => v.volume)).toEqual([2]);
});

test("canceled: cancel, ioc remainder, oco partner", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.cancel(1);
	m.submit(m.newMarketOrder(2, BUY, 1));
	expect(of("canceled").map((c) => c.id)).toEqual([1, 2]);
});

test("activated: a triggered stop", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newStopMarketOrder(2, BUY, 10, 1));
	m.submit(m.newMarketOrder(3, BUY, 1));
	expect(of("activated")).toEqual([{ id: 2, sequence: 3 }]);
});

test("bbo: fires when the best bid or ask changes after a command", () => {
	m.submit(m.newLimitOrder(1, BUY, 9, 5));
	m.submit(m.newLimitOrder(2, SELL, 11, 5));
	m.submit(m.newLimitOrder(3, BUY, 8, 5)); // no change
	m.submit(m.newLimitOrder(4, BUY, 9, 1)); // size of the best bid changed
	m.cancel(3); // no change

	expect(of("bbo")).toMatchObject([
		{ bid: { price: 9, amount: 5 }, ask: null },
		{ bid: { price: 9, amount: 5 }, ask: { price: 11, amount: 5 } },
		{ bid: { price: 9, amount: 6 }, ask: { price: 11, amount: 5 } },
	]);
});

test("bbo: one event per command, not per fill", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 11, 1));
	m.submit(m.newLimitOrder(3, SELL, 12, 1));
	events.length = 0;
	m.submit(m.newMarketOrder(4, BUY, 3));
	expect(of("bbo")).toMatchObject([{ bid: null, ask: null }]);
});

test("depth: emitted when requested", () => {
	m.submit(m.newLimitOrder(1, BUY, 9, 5));
	events.length = 0;
	const depth = m.depth();
	expect(of("depth")).toEqual([{ depth, sequence: 1 }]);
});

test("no emitter: no events and no failure", () => {
	const quiet = new Matchingo(TestSymbol, TestScales);
	quiet.submit(quiet.newLimitOrder(1, SELL, 10, 1));
	quiet.submit(quiet.newMarketOrder(2, BUY, 1));
	quiet.halt();
	expect(quiet.depth()).toBeTruthy();
});

test("an event stamps the sequence of the command", () => {
	m.submit(m.newLimitOrder(1, SELL, 10, 1));
	m.submit(m.newLimitOrder(2, SELL, 10, 1));
	events.length = 0;
	m.submit(m.newMarketOrder(3, BUY, 2));
	expect(new Set(of("trade").map((t) => t.sequence))).toEqual(new Set([3]));
});
