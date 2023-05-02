const { test, expect, beforeEach } = require("@jest/globals");
const { TestSymbol, SELL, LIMIT, BUY } = require("../src/constants");
const Matchingo = require("../src/matchingo");
const {
  createTestPriceOrder,
  createTestStopLimitPrice,
} = require("../src/new-order");

let matchingo;

beforeEach(() => {
  matchingo = new Matchingo(TestSymbol);
});

test("orders: add limit buy", function () {
  const o1 = createTestPriceOrder(1, LIMIT, BUY, 10, 100);
  const result = matchingo.process(o1);

  expect(result.order.id).toBe(1);
  expect(result.trades.length).toBe(0);
  expect(result.processed).toBe(0);
  expect(result.canceled.length).toBe(0);

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
  expect(matchingo.stopBook.getOrders()).toStrictEqual([]);
});

test("orders: add limit sell", function () {
  const o1 = createTestPriceOrder(1, LIMIT, SELL, 10, 100);
  const result = matchingo.process(o1);

  expect(result.order.id).toBe(1);
  expect(result.trades.length).toBe(0);
  expect(result.processed).toBe(0);
  expect(result.canceled.length).toBe(0);

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
  expect(matchingo.stopBook.getOrders()).toStrictEqual([]);
});

test("orders: cancel limit buy", function () {
  const o1 = createTestPriceOrder(1, LIMIT, BUY, 10, 100);
  const result = matchingo.process(o1);

  expect(result.order.id).toBe(1);
  expect(result.trades.length).toBe(0);
  expect(result.processed).toBe(0);
  expect(result.canceled.length).toBe(0);

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
  expect(matchingo.stopBook.getOrders()).toStrictEqual([]);

  expect(matchingo.cancel("fake")).toBeFalsy();
  expect(matchingo.cancel(o1.getKey())).toBeTruthy();

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
});

test("orders: cancel limit sell", function () {
  const o1 = createTestPriceOrder(1, LIMIT, SELL, 10, 100);
  const result = matchingo.process(o1);

  expect(result.order.id).toBe(1);
  expect(result.trades.length).toBe(0);
  expect(result.processed).toBe(0);
  expect(result.canceled.length).toBe(0);

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(100);
  expect(matchingo.stopBook.getOrders()).toStrictEqual([]);

  expect(matchingo.cancel("fake")).toBeFalsy();
  expect(matchingo.cancel(o1.getKey())).toBeTruthy();

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
});

test("orders: cancel stop limit buy", function () {
  const o1 = createTestStopLimitPrice(1, BUY, 9, 10, 100);

  expect(matchingo.process(o1)).toBe(true);

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
  expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual([
    "9",
  ]);

  expect(matchingo.cancel("fake")).toBeFalsy();
  expect(matchingo.cancel(o1.getKey())).toBeTruthy();

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
  expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual(
    [],
  );
});

test("orders: cancel stop limit sell", function () {
  const o1 = createTestStopLimitPrice(1, SELL, 9, 10, 100);

  expect(matchingo.process(o1)).toBe(true);

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
  expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual([
    "9",
  ]);

  expect(matchingo.cancel("fake")).toBeFalsy();
  expect(matchingo.cancel(o1.getKey())).toBeTruthy();

  expect(matchingo.orderBook.volume.getVolume(o1)).toBe(0);
  expect(Object.keys(matchingo.stopBook.getRaw()[TestSymbol])).toStrictEqual(
    [],
  );
});
