/**
 * Trading halt and circuit breaker.
 */

import { BUY, SELL } from "../src/constants.js";
import { ErrorCode } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, {
		...TestScales,
		circuitBreaker: 10,
		emitter: true,
	});
});

const trade = (id, price, amount = 1) => {
	m.submit(m.newLimitOrder(`s${id}`, SELL, price, amount));
	return m.submit(m.newMarketOrder(`b${id}`, BUY, amount));
};

test("the first trade never trips the breaker", () => {
	trade(1, 1000);
	expect(m.halted).toBe(false);
});

test("a move within the percentage does not halt", () => {
	trade(1, 100);
	trade(2, 110); // exactly 10%: not above
	expect(m.halted).toBe(false);
	trade(3, 99);
	expect(m.halted).toBe(false);
});

test("a move above the percentage halts the book", () => {
	trade(1, 100);
	trade(2, 111);
	expect(m.halted).toBe(true);
	expect(() => m.submit(m.newLimitOrder(9, BUY, 1, 1))).toThrow(
		expect.objectContaining({ code: ErrorCode.TRADING_HALTED }),
	);
});

test("a downward move halts too", () => {
	trade(1, 100);
	trade(2, 89);
	expect(m.halted).toBe(true);
});

test("the order that caused the breach finishes, including later levels and stops", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 1));
	m.submit(m.newMarketOrder(2, BUY, 1)); // reference price 100

	m.submit(m.newLimitOrder(3, SELL, 120, 1));
	m.submit(m.newLimitOrder(4, SELL, 130, 1));
	m.submit(m.newStopLimitOrder(5, BUY, 120, 130, 1));

	const done = m.submit(m.newMarketOrder(6, BUY, 2));
	expect(done.processed).toBe(2); // both levels traded
	expect(done.activated).toEqual([5]);
	expect(done.activations).toHaveLength(1);
	expect(m.halted).toBe(true);
});

test("later orders are rejected, cancels work, resume reopens", () => {
	trade(1, 100);
	m.submit(m.newLimitOrder("rest", BUY, 50, 1));
	trade(2, 150);
	expect(m.halted).toBe(true);

	expect(m.cancel("rest")).toBe(true);
	m.resume();
	expect(m.halted).toBe(false);
	expect(m.submit(m.newLimitOrder(10, BUY, 1, 1)).stored).toBe(true);
});

test("the last trade price survives a halt and a resume", () => {
	trade(1, 100);
	trade(2, 150); // trips; the last price is now 150
	m.resume();
	trade(3, 160); // 6.7% from 150
	expect(m.halted).toBe(false);
	trade(4, 100); // 37% from 160
	expect(m.halted).toBe(true);
});

test("halt and resume emit events", () => {
	const events = [];
	m.emitter.on("halt", ({ halted, circuitBreaker }) =>
		events.push([halted, circuitBreaker]),
	);
	trade(1, 100);
	trade(2, 200);
	m.resume();
	m.halt();
	m.resume();
	expect(events).toEqual([
		[true, true],
		[false, false],
		[true, false],
		[false, false],
	]);
});

test("halt and resume are idempotent", () => {
	const events = [];
	m.emitter.on("halt", (event) => events.push(event));
	m.halt();
	m.halt();
	m.resume();
	m.resume();
	expect(events).toHaveLength(2);
});

test("a manual halt keeps the contents and blocks submit", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.halt();
	expect(m.halted).toBe(true);
	expect(() => m.submit(m.newLimitOrder(2, BUY, 10, 5))).toThrow(
		expect.objectContaining({ code: ErrorCode.TRADING_HALTED }),
	);
	expect(m.order(1)).toBeTruthy();
});

test("circuitBreaker must be positive", () => {
	expect(
		() => new Matchingo(TestSymbol, { ...TestScales, circuitBreaker: 0 }),
	).toThrow("circuitBreaker");
	expect(
		() => new Matchingo(TestSymbol, { ...TestScales, circuitBreaker: -5 }),
	).toThrow("circuitBreaker");
});
