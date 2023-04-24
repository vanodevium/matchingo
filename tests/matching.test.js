const { test, expect, beforeEach } = require("@jest/globals");
const {
  Symbol,
  SELL,
  LIMIT,
  BUY,
  MARKET,
  FOK,
  IOC,
} = require("../src/constants");
const Matcher = require("./../src/matcher");
const {
  createTestPriceOrder,
  createTestStopLimitPrice,
} = require("../src/new-order");

let matcher;

beforeEach(() => {
  matcher = new Matcher(Symbol);
  // matcher.on("event", (data) => {
  //   console.log(JSON.stringify(data))
  // })
});

test("matcher: market floating", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 7.77, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 7.78, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 7.74, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const result = matcher.match(createTestPriceOrder(1, MARKET, BUY, 0, 36 * 8));

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.processed).toBe(36);
  expect(result.trade.processedQuote).toBe(279.45);
  expect(result.trade.leftQuote).toBe(36 * 8 - 279.45);
  expect(result.canceled.length).toBe(1);
});

test("matcher: market fulfilled", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 7.77, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 7.78, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 7.74, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const result = matcher.match(createTestPriceOrder(1, MARKET, BUY, 0, 279.45));

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.processedQuote).toBe(279.45);
  expect(result.trade.leftQuote).toBe(0);
  expect(result.canceled.length).toBe(0);
});

test("matcher: market partial", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 7.77, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 7.78, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 7.74, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const result = matcher.match(createTestPriceOrder(1, MARKET, BUY, 0, 280));

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.processedQuote).toBe(279.45);
  expect(result.canceled.length).toBe(1);
});

test("matcher: market partial less", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 7.77, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 7.78, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 7.74, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const result = matcher.match(
    createTestPriceOrder(1, MARKET, BUY, 0, 271.1990001)
  );

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.processedQuote).toBe(271.1990001);
  expect(result.canceled.length).toBe(0);
});

test("matcher: limit fulfilled", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 13, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const result = matcher.match(createTestPriceOrder(1, LIMIT, BUY, 13, 36));

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.orders[0].price).toBe(11);
  expect(result.trade.orders[0].amount).toBe(11);
  expect(result.trade.orders[1].price).toBe(12);
  expect(result.trade.orders[1].amount).toBe(12);
  expect(result.trade.orders[2].price).toBe(13);
  expect(result.trade.orders[2].amount).toBe(13);
  expect(result.canceled.length).toBe(0);

  expect(matcher.orderBook.volume.get(SELL)).toBe(0);
  expect(matcher.orderBook.volume.get(BUY)).toBe(0);
});

test("matcher: limit partial: over volume", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 13, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const result = matcher.match(createTestPriceOrder(1, LIMIT, BUY, 13, 40));

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.orders[0].price).toBe(11);
  expect(result.trade.orders[0].amount).toBe(11);
  expect(result.trade.orders[1].price).toBe(12);
  expect(result.trade.orders[1].amount).toBe(12);
  expect(result.trade.orders[2].price).toBe(13);
  expect(result.trade.orders[2].amount).toBe(13);
  expect(result.trade.processed).toBe(36);
  expect(result.trade.left).toBe(4);
  expect(result.canceled.length).toBe(0);

  expect(matcher.orderBook.volume.get(SELL)).toBe(0);
  expect(matcher.orderBook.volume.get(BUY)).toBe(4);
});

test("matcher: limit partial: less volume", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 13, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const result = matcher.match(createTestPriceOrder(1, LIMIT, BUY, 13, 24));

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.orders[0].price).toBe(11);
  expect(result.trade.orders[0].amount).toBe(11);
  expect(result.trade.orders[1].price).toBe(12);
  expect(result.trade.orders[1].amount).toBe(12);
  expect(result.trade.orders[2].price).toBe(13);
  expect(result.trade.orders[2].amount).toBe(1);
  expect(result.trade.processed).toBe(24);
  expect(result.trade.left).toBe(0);
  expect(result.canceled.length).toBe(0);

  expect(matcher.orderBook.volume.get(SELL)).toBe(12);
  expect(matcher.orderBook.volume.get(BUY)).toBe(0);
});

test("matcher: limit partial: FOK", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 13, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const o = createTestPriceOrder(1, LIMIT, BUY, 13, 40);
  o.tif = FOK;
  const result = matcher.match(o);

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(0);
  expect(result.canceled.length).toBe(1);

  expect(matcher.orderBook.volume.get(SELL)).toBe(36);
  expect(matcher.orderBook.volume.get(BUY)).toBe(0);
});

test("matcher: limit partial: IOC", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 13, 13);

  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const o = createTestPriceOrder(1, LIMIT, BUY, 13, 40);
  o.tif = IOC;
  const result = matcher.match(o);

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(3);
  expect(result.trade.processed).toBe(36);
  expect(result.trade.left).toBe(4);
  expect(result.canceled.length).toBe(1);

  expect(matcher.orderBook.volume.get(SELL)).toBe(0);
  expect(matcher.orderBook.volume.get(BUY)).toBe(0);
});

test("matcher: stop order", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 13, 13);

  const stop = createTestStopLimitPrice(100, SELL, 11, 12, 11);

  matcher.match(stop);
  matcher.match(o11);
  matcher.match(o12);
  matcher.match(o13);

  const o = createTestPriceOrder(1, LIMIT, BUY, 11, 11);
  const result = matcher.match(o);

  expect(result.trade.order.id).toBe(1);
  expect(result.trade.orders.length).toBe(1);
  expect(result.activated.length).toBe(1);
  expect(result.canceled.length).toBe(0);

  expect(matcher.orderBook.volume.get(SELL)).toBe(36);
  expect(matcher.orderBook.volume.get(BUY)).toBe(0);
});
