const { test, expect, beforeEach } = require("@jest/globals");
const { TestSymbol, SELL, LIMIT, BUY } = require("../src/constants");
const Matchingo = require("../src/matchingo");
const {
  createTestPriceOrder,
  createTestStopLimitPrice,
} = require("../src/new-order");

let matchingo;

beforeEach(() => {
  matchingo = new Matchingo(TestSymbol, true);
});

test("oco: basic canceling", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 7.77, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 7.78, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 7.74, 13);

  matchingo.process(o11);
  matchingo.process(o12);
  matchingo.process(o13);

  const oco1 = createTestStopLimitPrice(1, BUY, 7.77, 7.77, 11);
  const oco2 = createTestPriceOrder(2, LIMIT, BUY, 7.77, 11);

  oco1.setOCO(oco2.getKey());
  oco2.setOCO(oco1.getKey());

  matchingo.process(oco1);

  const result = matchingo.process(oco2);

  expect(result.order.id).toBe(2);
  expect(result.trades.length).toBe(2);
  expect(result.trades[1].id).toBe(13);
  expect(result.processed).toBe(11);
  expect(result.canceled.length).toBe(1);
  expect(result.canceled[0]).toBe(1);
});

test("oco: basic reverse canceling", function () {
  const o11 = createTestPriceOrder(11, LIMIT, SELL, 7.77, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 7.78, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 7.74, 13);

  matchingo.process(o11);
  matchingo.process(o12);
  matchingo.process(o13);

  const oco1 = createTestStopLimitPrice(1, BUY, 7.77, 7.77, 11);
  const oco2 = createTestPriceOrder(2, LIMIT, BUY, 7.77, 11);

  oco1.setOCO(oco2.getKey());
  oco2.setOCO(oco1.getKey());

  matchingo.process(oco2);

  const result = matchingo.process(oco1);

  expect(result.order.id).toBe(1);
  expect(result.trades.length).toBe(0);
  expect(result.processed).toBe(0);
  expect(result.canceled.length).toBe(1);
  expect(result.canceled[0]).toBe(1);
});
