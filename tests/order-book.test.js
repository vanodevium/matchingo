const { test, expect, beforeEach } = require("@jest/globals");
const { TestSymbol, SELL, LIMIT, BUY } = require("../src/constants");
const Matchingo = require("../src/matchingo");
const OrderBook = require("../src/order-book");
const { createTestPriceOrder } = require("../src/new-order");

let matchingo;

beforeEach(() => {
  matchingo = new Matchingo(TestSymbol);
});

test("order book instance: duplicates", function () {
  const orderBook = new OrderBook(TestSymbol);
  orderBook.append(createTestPriceOrder(1, LIMIT, BUY, 11, 100));
  orderBook.append(createTestPriceOrder(1, LIMIT, BUY, 11, 100));

  expect(Object.keys(orderBook.getRaw()[TestSymbol][BUY])).toStrictEqual([
    "11",
  ]);

  Object.values(orderBook.getRaw()[TestSymbol][BUY]).forEach((queue) => {
    expect(queue.size()).toBe(1);
  });
});

test("order book: duplicates", function () {
  matchingo.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));
  matchingo.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));

  expect(
    Object.keys(matchingo.orderBook.getRaw()[TestSymbol][BUY]),
  ).toStrictEqual(["11"]);

  Object.values(matchingo.orderBook.getRaw()[TestSymbol][BUY]).forEach(
    (queue) => {
      expect(queue.size()).toBe(1);
    },
  );
});

test("order book: getRaw buy", function () {
  matchingo.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));
  matchingo.process(createTestPriceOrder(2, LIMIT, BUY, 12, 200));
  matchingo.process(createTestPriceOrder(3, LIMIT, BUY, 13, 300));

  expect(
    Object.keys(matchingo.orderBook.getRaw()[TestSymbol][BUY]),
  ).toStrictEqual(["11", "12", "13"]);

  Object.values(matchingo.orderBook.getRaw()[TestSymbol][BUY]).forEach(
    (queue) => {
      expect(queue.size()).toBe(1);
    },
  );
});

test("order book: getRaw sell", function () {
  matchingo.process(createTestPriceOrder(1, LIMIT, SELL, 11, 100));
  matchingo.process(createTestPriceOrder(2, LIMIT, SELL, 12, 200));
  matchingo.process(createTestPriceOrder(3, LIMIT, SELL, 13, 300));

  expect(
    Object.keys(matchingo.orderBook.getRaw()[TestSymbol][SELL]),
  ).toStrictEqual(["11", "12", "13"]);
  Object.values(matchingo.orderBook.getRaw()[TestSymbol][SELL]).forEach(
    (queue) => {
      expect(queue.size()).toBe(1);
    },
  );
});
