/**
 * OCO (One-Cancels-the-Other) rules:
 * when one leg fills or activates, the sibling is immediately canceled.
 * Covers limit/stop pairs in both orders, and behavior after dump/restore.
 */

import { BUY, LIMIT, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import {
	createTestPriceOrder,
	createTestStopLimitPrice,
	TestScales,
	TestSymbol,
} from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, emitter: true });
});

// ---------------------------------------------------------------------------
// Limit fills → stop sibling canceled
// ---------------------------------------------------------------------------

test("OCO: limit fills — stop sibling canceled", () => {
	m.process(m.newLimitOrder(1, SELL, 100, 10));

	const lim = m.newLimitOrder(2, BUY, 100, 10);
	const stop = m.newStopLimitOrder(3, BUY, 110, 115, 10);
	lim.setOCO(stop.getKey());
	stop.setOCO(lim.getKey());
	m.process(stop);

	const done = m.process(lim);
	expect(done.processed).toBe(10);
	expect(done.canceled).toContain(3);
	expect(m.stopBook.find(3)).toBeFalsy();
});

test("OCO: limit fills — stop sibling NOT found after cancel", () => {
	const oco1 = createTestStopLimitPrice(1, BUY, 7.77, 7.77, 11);
	const oco2 = createTestPriceOrder(2, LIMIT, BUY, 7.77, 11);
	oco1.setOCO(oco2.getKey());
	oco2.setOCO(oco1.getKey());

	m.process(createTestPriceOrder(13, LIMIT, SELL, 7.74, 13));
	m.process(oco1);
	const done = m.process(oco2);

	expect(done.trades.length).toBe(2);
	expect(done.canceled).toContain(1);
	expect(m.order(1)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Stop fills → limit sibling canceled
// ---------------------------------------------------------------------------

test("OCO: stop activates and fills — limit sibling canceled", () => {
	const lim = createTestPriceOrder(2, LIMIT, BUY, 7.77, 11);
	const stop = createTestStopLimitPrice(1, BUY, 7.77, 7.77, 11);
	stop.setOCO(lim.getKey());
	lim.setOCO(stop.getKey());

	m.process(createTestPriceOrder(13, LIMIT, SELL, 7.74, 13));
	m.process(lim);
	const done = m.process(stop);

	// stop was processed — lim was already matched → stop is the OCO-canceled one
	expect(done.canceled).toContain(1);
});

test("OCO: reverse — limit processes first, stop processed second is instantly canceled", () => {
	const oco1 = createTestStopLimitPrice(1, BUY, 7.77, 7.77, 11);
	const oco2 = createTestPriceOrder(2, LIMIT, BUY, 7.77, 11);
	oco1.setOCO(oco2.getKey());
	oco2.setOCO(oco1.getKey());

	m.process(createTestPriceOrder(13, LIMIT, SELL, 7.74, 13));
	m.process(oco2); // limit fills, marks stop for cancel

	const done = m.process(oco1); // stop is immediately OCO-canceled
	expect(done.order.id).toBe(1);
	expect(done.trades).toEqual([]);
	expect(done.canceled).toContain(1);
});

// ---------------------------------------------------------------------------
// After dump/restore
// ---------------------------------------------------------------------------

test("OCO dump/restore: cancel propagates after restore", () => {
	const lim = m.newLimitOrder(1, SELL, 100, 10);
	const stop = m.newStopLimitOrder(2, SELL, 80, 79, 10);
	lim.setOCO(2);
	stop.setOCO(1);
	m.process(lim);
	m.process(stop);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	// A buy fills the limit — stop sibling must be canceled
	const done = m2.process(m2.newLimitOrder(3, BUY, 100, 10));
	expect(done.trades.length).toBe(2);
	expect(done.canceled).toContain(2);
	expect(m2.stopBook.find(2)).toBeFalsy();
});

test("OCO dump/restore: stop activates and cancels limit sibling", () => {
	const lim = m.newLimitOrder(1, SELL, 110, 10);
	const stop = m.newStopLimitOrder(2, SELL, 90, 85, 10);
	lim.setOCO(2);
	stop.setOCO(1);
	m.process(lim);
	m.process(stop);

	const m2 = new Matchingo(TestSymbol, TestScales);
	m2.restore(m.dump());

	m2.process(m2.newLimitOrder(3, BUY, 85, 10)); // bid for the stop to fill against

	// market sell crosses below 90, triggering stop 2
	const done = m2.process(m2.newMarketOrder(4, SELL, 1));
	expect(done.activated).toContain(2);

	const activation = done.activations[0];
	expect(activation.canceled).toContain(1); // limit sibling canceled
	expect(m2.order(1)).toBeFalsy();
});
