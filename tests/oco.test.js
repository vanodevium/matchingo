/**
 * OCO (One-Cancels-the-Other) rules:
 * when an order executes to completion, its partner is canceled.
 * A partial fill alone does not trigger it. A trigger for a partner that
 * is not on the book yet is remembered.
 */

import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, emitter: true });
});

// ---------------------------------------------------------------------------
// A taker that is complete cancels its partner
// ---------------------------------------------------------------------------

test("OCO: limit taker fully matched — stop partner canceled", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10));

	const lim = m.newLimitOrder(2, BUY, 100, 10).setOCO(3);
	m.submit(m.newStopLimitOrder(3, BUY, 110, 115, 10));

	const done = m.submit(lim);
	expect(done.processed).toBe(10);
	expect(done.canceled).toEqual([3]);
	expect(m.stopBook.find(3)).toBeFalsy();
});

test("OCO: a partial fill alone does not cancel the partner", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 4));
	m.submit(m.newStopLimitOrder(3, BUY, 110, 115, 10));

	const done = m.submit(m.newLimitOrder(2, BUY, 100, 10).setOCO(3));
	expect(done.processed).toBe(4);
	expect(done.stored).toBe(true);
	expect(done.canceled).toEqual([]);
	expect(m.stopBook.find(3)).toBeTruthy();
});

test("OCO: a market order that traded cancels the partner", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 4));
	m.submit(m.newStopLimitOrder(3, BUY, 110, 115, 10));

	const done = m.submit(m.newMarketOrder(2, BUY, 10).setOCO(3));
	expect(done.processed).toBe(4);
	expect(done.canceled).toEqual([2, 3]);
	expect(m.stopBook.find(3)).toBeFalsy();
});

test("OCO: a market order that did not trade leaves the partner", () => {
	m.submit(m.newStopLimitOrder(3, BUY, 110, 115, 10));
	const done = m.submit(m.newMarketOrder(2, BUY, 10).setOCO(3));
	expect(done.canceled).toEqual([2]);
	expect(m.stopBook.find(3)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// A maker that is completely filled cancels its partner
// ---------------------------------------------------------------------------

test("OCO: resting maker completely filled — partner canceled", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10).setOCO(2));
	m.submit(m.newLimitOrder(2, BUY, 50, 10));

	const done = m.submit(m.newLimitOrder(3, BUY, 100, 10));
	expect(done.canceled).toEqual([2]);
	expect(m.order(2)).toBeNull();
});

test("OCO: resting maker partly filled — partner stays", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10).setOCO(2));
	m.submit(m.newLimitOrder(2, BUY, 50, 10));

	const done = m.submit(m.newLimitOrder(3, BUY, 100, 4));
	expect(done.canceled).toEqual([]);
	expect(m.order(2)).toBeTruthy();
});

test("OCO: iceberg maker cancels its partner only when the total is filled", () => {
	m.submit(m.newIcebergOrder(1, SELL, 100, 20, 5).setOCO(2));
	m.submit(m.newLimitOrder(2, BUY, 50, 10));

	expect(m.submit(m.newLimitOrder(3, BUY, 100, 5)).canceled).toEqual([]);
	expect(m.submit(m.newLimitOrder(4, BUY, 100, 15)).canceled).toEqual([2]);
});

// ---------------------------------------------------------------------------
// The partner arrives later
// ---------------------------------------------------------------------------

test("OCO: partner that arrives after the trigger is canceled at once", () => {
	m.submit(m.newLimitOrder(13, SELL, 100, 13));
	m.submit(m.newLimitOrder(2, BUY, 100, 11).setOCO(1));

	const done = m.submit(m.newStopLimitOrder(1, BUY, 110, 115, 11));
	expect(done.order.id).toBe(1);
	expect(done.trades).toEqual([]);
	expect(done.canceled).toEqual([1]);
	expect(done.stored).toBe(false);
	expect(m.order(1)).toBeNull();
});

test("OCO: the trigger is used once", () => {
	m.submit(m.newLimitOrder(13, SELL, 100, 13));
	m.submit(m.newLimitOrder(2, BUY, 100, 11).setOCO(1));
	m.submit(m.newLimitOrder(1, BUY, 90, 1)); // canceled by the marker

	expect(m.submit(m.newLimitOrder(1, BUY, 90, 1)).stored).toBe(true);
});

// ---------------------------------------------------------------------------
// Activated stops
// ---------------------------------------------------------------------------

test("OCO: stop activates and fills completely — limit partner canceled", () => {
	m = new Matchingo(TestSymbol, DecimalScales);
	m.submit(m.newLimitOrder(13, SELL, 7.74, 13));
	m.submit(m.newLimitOrder(2, BUY, 7.7, 11));
	m.submit(m.newStopLimitOrder(1, BUY, 7.74, 7.77, 11).setOCO(2));

	const done = m.submit(m.newMarketOrder(5, BUY, 1));
	expect(done.activated).toEqual([1]);
	expect(done.activations[0].processed).toBe(11);
	expect(done.activations[0].canceled).toEqual([2]);
	expect(m.order(2)).toBeNull();
});

// ---------------------------------------------------------------------------
// After dump/restore
// ---------------------------------------------------------------------------

test("OCO dump/restore: cancel propagates after restore", () => {
	m.submit(m.newLimitOrder(1, SELL, 100, 10).setOCO(2));
	m.submit(m.newStopLimitOrder(2, SELL, 80, 79, 10).setOCO(1));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	const done = m2.submit(m2.newLimitOrder(3, BUY, 100, 10));
	expect(done.trades.length).toBe(2);
	expect(done.canceled).toContain(2);
	expect(m2.stopBook.find(2)).toBeFalsy();
});

test("OCO dump/restore: pending triggers survive", () => {
	m.submit(m.newLimitOrder(13, SELL, 100, 13));
	m.submit(m.newLimitOrder(2, BUY, 100, 11).setOCO(1));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	const done = m2.submit(m2.newStopLimitOrder(1, BUY, 110, 115, 11));
	expect(done.canceled).toEqual([1]);
});

test("OCO dump/restore: stop activates and cancels limit sibling", () => {
	m.submit(m.newLimitOrder(1, SELL, 110, 10).setOCO(2));
	m.submit(m.newStopLimitOrder(2, SELL, 90, 85, 10).setOCO(1));

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	m2.submit(m2.newLimitOrder(3, BUY, 85, 20)); // bid for the stop to fill against

	// market sell trades below 90, triggering stop 2
	const done = m2.submit(m2.newMarketOrder(4, SELL, 1));
	expect(done.activated).toContain(2);

	const activation = done.activations[0];
	expect(activation.canceled).toContain(1); // limit sibling canceled
	expect(m2.order(1)).toBeNull();
});
