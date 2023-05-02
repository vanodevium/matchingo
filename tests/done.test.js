const { test, expect } = require("@jest/globals");
const { TestSymbol } = require("../src/constants");
const Trade = require("./../src/models/trade");
const Done = require("./../src/models/done");
const Matchingo = require("./../");
const matchingo = new Matchingo(TestSymbol);

test("done structure limit no trades", function () {
  const main = matchingo.newLimitOrder("main", Matchingo.BUY, 111, 111);
  const trade = new Trade(main);

  const done = new Done(
    trade,
    [matchingo.newLimitOrder("canceled", Matchingo.SELL, 111, 10)],
    [matchingo.newLimitOrder("activated", Matchingo.SELL, 111, 10)],
  );

  expect(done).toEqual({
    order: {
      id: "main",
      price: 111,
      isQuote: false,
      amount: 0,
      role: "TAKER",
    },
    trades: [],
    processed: 0,
    left: 0,
    canceled: ["canceled"],
    activated: ["activated"],
  });
});

test("done structure limit", function () {
  const main = matchingo.newLimitOrder("main", Matchingo.BUY, 111, 111);
  const trade = new Trade(main);

  const orders = [];

  for (let i = 10; i < 15; i++) {
    let o = matchingo.newLimitOrder("order" + i, Matchingo.SELL, 111, i);
    o.increase(10, 111, false);
    o.tradePrice = o.price;
    orders.push(o);
  }

  trade.setOrders(orders);

  const done = new Done(
    trade,
    [matchingo.newLimitOrder("canceled", Matchingo.SELL, 111, 10)],
    [matchingo.newLimitOrder("activated", Matchingo.SELL, 111, 10)],
  );

  expect(done).toEqual({
    order: {
      id: "main",
      price: 111,
      isQuote: false,
      amount: 50,
      role: "TAKER",
    },
    trades: [
      {
        id: "main",
        price: 111,
        isQuote: false,
        amount: 50,
        role: "TAKER",
      },
      {
        id: "order10",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order11",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order12",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order13",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order14",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
    ],
    processed: 50,
    left: 61,
    canceled: ["canceled"],
    activated: ["activated"],
  });
});

test("done structure market", function () {
  const main = matchingo.newMarketBuyQuoteOrder("main", 5555);
  const trade = new Trade(main);

  const orders = [];

  for (let i = 10; i < 15; i++) {
    let o = matchingo.newLimitOrder("order" + i, Matchingo.SELL, 111, i);
    o.increase(10, 111, false);
    o.tradePrice = o.price;
    orders.push(o);
  }

  trade.setOrders(orders);

  const done = new Done(
    trade,
    [matchingo.newLimitOrder("canceled", Matchingo.SELL, 111, 10)],
    [matchingo.newLimitOrder("activated", Matchingo.SELL, 111, 10)],
  );

  expect(done).toEqual({
    order: {
      id: "main",
      price: 0,
      isQuote: true,
      amount: 5550,
      role: "TAKER",
    },
    trades: [
      {
        id: "main",
        price: 0,
        isQuote: true,
        amount: 5550,
        role: "TAKER",
      },
      {
        id: "order10",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order11",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order12",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order13",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
      {
        id: "order14",
        price: 111,
        isQuote: false,
        amount: 10,
        role: "TAKER",
      },
    ],
    processed: 5550,
    left: 5,
    canceled: ["canceled"],
    activated: ["activated"],
  });
});
