/**
 * Post-only limit order rules:
 * rests when it would not match, canceled when it would match immediately.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, TestScales);
});

test("post-only: rests when book is empty", () => {
	const done = m.process(m.newPostOnlyLimitOrder(1, BUY, 100, 10));
	expect(done.canceled).toEqual([]);
	expect(m.order(1)).toBeTruthy();
});

test("post-only: rests when buy price is below best ask", () => {
	m.process(m.newLimitOrder(2, SELL, 101, 10));
	const done = m.process(m.newPostOnlyLimitOrder(1, BUY, 100, 5));
	expect(done.canceled).toEqual([]);
	expect(m.order(1)).toBeTruthy();
});

test("post-only: canceled when buy price crosses ask", () => {
	m.process(m.newLimitOrder(2, SELL, 100, 10));

	const done = m.process(m.newPostOnlyLimitOrder(1, BUY, 100, 5));
	expect(done.canceled).toContain(1);
	expect(done.trades).toEqual([]);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy(); // resting ask untouched
});

test("post-only: canceled when sell price crosses bid", () => {
	m.process(m.newLimitOrder(2, BUY, 100, 10));

	const done = m.process(m.newPostOnlyLimitOrder(1, SELL, 100, 5));
	expect(done.canceled).toContain(1);
	expect(done.trades).toEqual([]);
	expect(m.order(1)).toBeFalsy();
	expect(m.order(2)).toBeTruthy();
});

test("post-only: persists through dump/restore", () => {
	m.process(m.newPostOnlyLimitOrder(1, BUY, 100, 10));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	const restored = m2.order(1);
	expect(restored).toBeTruthy();
	expect(restored.postOnly).toBe(true);
});
