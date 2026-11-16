import { BUY, FOK, IOC, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestSymbol } from "./constants.js";

let matchingo;

beforeEach(() => {
	matchingo = new Matchingo(TestSymbol, true);
});

test("process: empty order", () => {
	expect(matchingo.process()).toBeUndefined();
});

test("process: market floating quote format", () => {
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
	expect(result.left).toBe(36 * 8 - 279.45);
	expect(result.canceled.length).toBe(1);
});

test("process: market floating base format", () => {
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
	expect(result.left).toBe(280 - 279.45);
	expect(result.canceled.length).toBe(1);
});

test("process: market fulfilled", () => {
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
	const o11 = matchingo.newLimitOrder(11, SELL, 7.77, 11);
	const o12 = matchingo.newLimitOrder(12, SELL, 7.78, 12);
	const o13 = matchingo.newLimitOrder(13, SELL, 7.74, 13);

	matchingo.process(o11);
	matchingo.process(o12);
	matchingo.process(o13);

	const result = matchingo.process(
		matchingo.newMarketBuyQuoteOrder(1, 271.1990001),
	);

	expect(result.order.id).toBe(1);
	expect(result.order.isQuote).toBe(true);
	expect(result.order.price).toBe(0);
	expect(result.order.amount).toBe(271.1990001);
	expect(result.trades.length).toBe(4);
	expect(result.processed).toBe(271.1990001);
	expect(result.canceled.length).toBe(0);

	const result1 = matchingo.process(matchingo.newMarketBuyQuoteOrder(333, 333));

	expect(result1.order.id).toBe(333);
	expect(result1.trades.length).toBe(2);
	expect(result1.processed).toBe(8.250999900000032);
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
