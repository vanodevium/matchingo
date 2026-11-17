import { BUY, FOK, IOC, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let matchingo;

beforeEach(() => {
	matchingo = new Matchingo(TestSymbol, true, TestScales);
});

test("process: empty order", () => {
	expect(matchingo.process()).toBeUndefined();
});

test("process: market floating quote format", () => {
	matchingo = new Matchingo(TestSymbol, true, DecimalScales);
	const o11 = matchingo.newLimitOrder(11, SELL, 7.77, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 7.78, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 7.74, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newMarketBuyQuoteOrder(1, 36 * 8));

	expect(result.order.id).toBe(1);
	expect(result.order.isQuote).toBe(true);
	expect(result.order.price).toBe(0);
	expect(result.order.amount).toBe(279.45);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(279.45);
	expect(result.left).toBe(8.55);
	expect(result.canceled.length).toBe(1);
});

test("process: market floating base format", () => {
	matchingo = new Matchingo(TestSymbol, true, DecimalScales);
	const o11 = matchingo.newLimitOrder(11, SELL, 7.77, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 7.78, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 7.74, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newMarketOrder(1, BUY, 36));

	expect(result.order.id).toBe(1);
	expect(result.order.isQuote).toBe(false);
	expect(result.order.price).toBe(0);
	expect(result.order.amount).toBe(36);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(36);
	expect(result.left).toBe(0);
	expect(result.canceled.length).toBe(0);
});

test("process: market floating quote format sell", () => {
	matchingo = new Matchingo(TestSymbol, true, DecimalScales);
	const o11 = matchingo.newLimitOrder(11, BUY, 7.77, 11);
	const o12 = matchingo.newLimitOrder(12, BUY, 7.78, 12);
	const o13 = matchingo.newLimitOrder(13, BUY, 7.74, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const market = matchingo.newMarketSellQuoteOrder(1, 280);
	market.setQuoteMode();

	const result = matchingo.process(market);

	expect(result.order.id).toBe(1);
	expect(result.order.isQuote).toBe(true);
	expect(result.order.price).toBe(0);
	expect(result.order.amount).toBe(279.45);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(279.45);
	expect(result.left).toBe(0.55);
	expect(result.canceled.length).toBe(1);
});

test("process: market fulfilled", () => {
	matchingo = new Matchingo(TestSymbol, true, DecimalScales);
	const o11 = matchingo.newLimitOrder(11, SELL, 7.77, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 7.78, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 7.74, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newMarketBuyQuoteOrder(1, 279.45));

	expect(result.order.id).toBe(1);
	expect(result.order.isQuote).toBe(true);
	expect(result.order.price).toBe(0);
	expect(result.order.amount).toBe(279.45);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(279.45);
	expect(result.left).toBe(0);
	expect(result.canceled.length).toBe(0);
});

test("process: market partial", () => {
	matchingo = new Matchingo(TestSymbol, true, DecimalScales);
	const o11 = matchingo.newLimitOrder(11, SELL, 7.77, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 7.78, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 7.74, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newMarketBuyQuoteOrder(1, 280));

	expect(result.order.id).toBe(1);
	expect(result.order.isQuote).toBe(true);
	expect(result.order.price).toBe(0);
	expect(result.order.amount).toBe(279.45);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(279.45);
	expect(result.canceled.length).toBe(1);
});

test("process: market partial less", () => {
	matchingo = new Matchingo(TestSymbol, true, DecimalScales);
	const o11 = matchingo.newLimitOrder(11, SELL, 7.77, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 7.78, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 7.74, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(
		matchingo.newMarketBuyQuoteOrder(1, 271.199),
	);

	expect(result.order.id).toBe(1);
	expect(result.order.isQuote).toBe(true);
	expect(result.order.price).toBe(0);
	// the last trade buys 10.939 base units; 0.003 of the budget is dust
	expect(result.order.amount).toBe(271.196);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(271.196);
	expect(result.left).toBe(0.003);
	expect(result.canceled).toStrictEqual([1]);

	const result1 = matchingo.process(matchingo.newMarketBuyQuoteOrder(333, 333));

	expect(result1.order.id).toBe(333);
	expect(result1.trades.length).toBe(2);
	expect(result1.processed).toBe(8.255);
	expect(result1.canceled.length).toBe(1);
});

test("process: limit fulfilled sell", () => {
	const o11 = matchingo.newLimitOrder(11, BUY, 11, 11);
	const o12 = matchingo.newLimitOrder(12, BUY, 12, 12);
	const o13 = matchingo.newLimitOrder(13, BUY, 13, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newLimitOrder(1, SELL, 10, 36));

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(4);
	expect(result.trades[1].price).toBe(13);
	expect(result.trades[1].amount).toBe(13);
	expect(result.trades[2].price).toBe(12);
	expect(result.trades[2].amount).toBe(12);
	expect(result.trades[3].price).toBe(11);
	expect(result.trades[3].amount).toBe(11);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.get(SELL)).toBe(0);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(0);
});

test("process: limit fulfilled buy", () => {
	const o11 = matchingo.newLimitOrder(11, SELL, 11, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 12, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 13, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newLimitOrder(1, BUY, 13, 36));

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(4);
	expect(result.trades[1].price).toBe(11);
	expect(result.trades[1].amount).toBe(11);
	expect(result.trades[2].price).toBe(12);
	expect(result.trades[2].amount).toBe(12);
	expect(result.trades[3].price).toBe(13);
	expect(result.trades[3].amount).toBe(13);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.get(SELL)).toBe(0);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(0);
});

test("process: limit partial: over volume", () => {
	const o11 = matchingo.newLimitOrder(11, SELL, 11, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 12, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 13, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newLimitOrder(1, BUY, 13, 40));

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(4);
	expect(result.trades[1].price).toBe(11);
	expect(result.trades[1].amount).toBe(11);
	expect(result.trades[2].price).toBe(12);
	expect(result.trades[2].amount).toBe(12);
	expect(result.trades[3].price).toBe(13);
	expect(result.trades[3].amount).toBe(13);
	expect(result.processed).toBe(36);
	expect(result.left).toBe(4);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.get(SELL)).toBe(0);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(4);
});

test("process: limit partial: less volume", () => {
	const o11 = matchingo.newLimitOrder(11, SELL, 11, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 12, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 13, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(matchingo.newLimitOrder(1, BUY, 13, 24));

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(4);
	expect(result.trades[1].price).toBe(11);
	expect(result.trades[1].amount).toBe(11);
	expect(result.trades[2].price).toBe(12);
	expect(result.trades[2].amount).toBe(12);
	expect(result.trades[3].price).toBe(13);
	expect(result.trades[3].amount).toBe(1);
	expect(result.processed).toBe(24);
	expect(result.left).toBe(0);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.get(SELL)).toBe(12);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(0);
});

test("process: limit partial: FOK", () => {
	const o11 = matchingo.newLimitOrder(11, SELL, 11, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 12, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 13, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const o = matchingo.newLimitOrder(1, BUY, 13, 40);
	o.tif = FOK;
	const result = matchingo.process(o);

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(0);
	expect(result.canceled.length).toBe(1);

	expect(matchingo.orderBook.volume.get(SELL)).toBe(36);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(0);
});

test("process: limit partial: IOC", () => {
	const o11 = matchingo.newLimitOrder(11, SELL, 11, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 12, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 13, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const o = matchingo.newLimitOrder(1, BUY, 13, 40);
	o.tif = IOC;
	const result = matchingo.process(o);

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(36);
	expect(result.left).toBe(4);
	expect(result.canceled.length).toBe(1);

	expect(matchingo.orderBook.volume.get(SELL)).toBe(0);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(0);
});

test("process: stop order", () => {
	const o11 = matchingo.newLimitOrder(11, SELL, 11, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 12, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 13, 13);

	const stop = matchingo.newStopLimitOrder(100, SELL, 11, 12, 11);

	matchingo.process(stop);
	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const o = matchingo.newLimitOrder(1, BUY, 11, 11);
	const result = matchingo.process(o);

	expect(result.order.id).toBe(1);
	expect(result.trades.length).toBe(2);
	expect(result.activated.length).toBe(1);
	expect(result.canceled.length).toBe(0);

	expect(matchingo.orderBook.volume.get(SELL)).toBe(36);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(0);
});

test("process: BUY stop activates when price jumps over the stop", () => {
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 15, 5));
	matchingo.process(matchingo.newLimitOrder(1, SELL, 12, 10));

	const result = matchingo.process(matchingo.newMarketOrder(2, BUY, 10));

	expect(result.activated).toStrictEqual([100]);
	expect(matchingo.stopBook.find(100)).toBe(false);
});

test("process: SELL stop activates when price jumps below the stop", () => {
	matchingo.process(matchingo.newStopLimitOrder(100, SELL, 10, 9, 5));
	matchingo.process(matchingo.newLimitOrder(1, BUY, 8, 10));

	const result = matchingo.process(matchingo.newMarketOrder(2, SELL, 10));

	expect(result.activated).toStrictEqual([100]);
});

test("process: BUY stop does not activate when price is below stop", () => {
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 12, 13, 5));
	matchingo.process(matchingo.newLimitOrder(1, SELL, 11, 10));

	const result = matchingo.process(matchingo.newMarketOrder(2, BUY, 10));

	expect(result.activated.length).toBe(0);
	expect(matchingo.stopBook.find(100)).toBeTruthy();
});

test("process: activated stop order is matched, not only added", () => {
	matchingo.process(matchingo.newLimitOrder(1, SELL, 10, 1));
	matchingo.process(matchingo.newLimitOrder(2, SELL, 11, 5));
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 11, 5));

	const result = matchingo.process(matchingo.newMarketOrder(3, BUY, 1));

	expect(result.activated).toStrictEqual([100]);
	expect(result.trades.map((t) => t.id)).toStrictEqual([3, 1]);
	expect(result.activations.length).toBe(1);
	expect(result.activations[0].order.id).toBe(100);
	expect(result.activations[0].trades.map((t) => t.id)).toStrictEqual([100, 2]);
	expect(result.activations[0].processed).toBe(5);
	expect(matchingo.orderBook.volume.get(SELL)).toBe(0);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(0);
	expect(matchingo.order(100)).toBe(false);
});

test("process: stop does not fire without a trade", () => {
	matchingo.process(matchingo.newLimitOrder(1, SELL, 10, 5));
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 11, 1));

	const result = matchingo.process(matchingo.newLimitOrder(2, BUY, 9, 1));

	expect(result.trades.length).toBe(0);
	expect(result.activated.length).toBe(0);
	expect(matchingo.stopBook.find(100)).toBeTruthy();
});

test("process: stop fires on a trade in the middle of a price level", () => {
	matchingo.process(matchingo.newLimitOrder(1, SELL, 10, 1));
	matchingo.process(matchingo.newLimitOrder(2, SELL, 10, 1));
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 10, 1));

	const result = matchingo.process(matchingo.newMarketOrder(3, BUY, 1));

	// the caller order finishes first; the stop order trades with the next maker
	expect(result.trades.map((t) => t.id)).toStrictEqual([3, 1]);
	expect(result.activations[0].trades.map((t) => t.id)).toStrictEqual([100, 2]);
});

test("process: stop fires when the trade price is above the stop", () => {
	matchingo.process(matchingo.newLimitOrder(1, SELL, 12, 1));
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 9, 1));

	const result = matchingo.process(matchingo.newMarketOrder(2, BUY, 1));

	expect(result.activated).toStrictEqual([100]);
	expect(matchingo.order(100).price).toBe(9);
});

test("process: activated stop orders can fire other stop orders", () => {
	matchingo.process(matchingo.newLimitOrder(1, SELL, 10, 1));
	matchingo.process(matchingo.newLimitOrder(2, SELL, 12, 1));
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 12, 1));
	matchingo.process(matchingo.newStopLimitOrder(101, BUY, 12, 13, 1));

	const result = matchingo.process(matchingo.newMarketOrder(3, BUY, 1));

	expect(result.activated).toStrictEqual([100]);
	expect(result.activations.map((a) => a.order.id)).toStrictEqual([100, 101]);
	expect(result.activations[0].activated).toStrictEqual([101]);
});

test("process: activated stop order sends its own events", () => {
	const events = [];
	matchingo.emitter.on(TestSymbol, (header, data) =>
		events.push([header.type, data.trade?.id ?? data.id]),
	);
	matchingo.process(matchingo.newLimitOrder(1, SELL, 10, 1));
	matchingo.process(matchingo.newLimitOrder(2, SELL, 11, 1));
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 11, 1));
	events.length = 0;

	matchingo.process(matchingo.newMarketOrder(3, BUY, 1));

	const trades = events
		.filter(([type]) => type === "trade")
		.map(([, id]) => id);
	expect(trades).toStrictEqual([3, 1, 100, 2]);
	expect(events).toContainEqual(["activated", 100]);
});

test("process: activated stop order rests when it does not cross", () => {
	matchingo.process(matchingo.newLimitOrder(1, SELL, 10, 1));
	matchingo.process(matchingo.newStopLimitOrder(100, BUY, 10, 9, 5));

	const result = matchingo.process(matchingo.newMarketOrder(3, BUY, 1));

	expect(result.activated).toStrictEqual([100]);
	expect(matchingo.orderBook.volume.get(BUY)).toBe(5);
	expect(matchingo.order(100).price).toBe(9);
});
