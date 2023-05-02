const { test, expect } = require("@jest/globals");
const { SELL, LIMIT } = require("../src/constants");
const OrderedSetOrdersQueue = require("./../src/ordered-set-orders-queue");
const { createTestPriceOrder } = require("./../src/new-order");

test("ordered map: next", function () {
  const orderedQueue = new OrderedSetOrdersQueue("ASC");

  orderedQueue.append(createTestPriceOrder(21, LIMIT, SELL, 22, 1));
  orderedQueue.append(createTestPriceOrder(22, LIMIT, SELL, 22, 2));
  orderedQueue.append(createTestPriceOrder(23, LIMIT, SELL, 22, 3));
  orderedQueue.append(createTestPriceOrder(24, LIMIT, SELL, 22, 4));
  orderedQueue.append(createTestPriceOrder(25, LIMIT, SELL, 22, 5));

  orderedQueue.append(createTestPriceOrder(11, LIMIT, SELL, 11, 1));
  orderedQueue.append(createTestPriceOrder(12, LIMIT, SELL, 11, 2));
  orderedQueue.append(createTestPriceOrder(13, LIMIT, SELL, 11, 3));
  orderedQueue.append(createTestPriceOrder(14, LIMIT, SELL, 11, 4));
  orderedQueue.append(createTestPriceOrder(15, LIMIT, SELL, 11, 5));

  let next = orderedQueue.next();
  while (!next.done) {
    for (const order of next.value) {
      orderedQueue.fastRemove(order);
    }
    next = orderedQueue.next();
  }

  expect(orderedQueue.ordered.values).toStrictEqual({});
});

test("ordered map: iterator", function () {
  const orderedQueue = new OrderedSetOrdersQueue("DESC");

  orderedQueue.append(createTestPriceOrder(11, LIMIT, SELL, 11, 1));
  orderedQueue.append(createTestPriceOrder(12, LIMIT, SELL, 11, 2));
  orderedQueue.append(createTestPriceOrder(13, LIMIT, SELL, 11, 3));
  orderedQueue.append(createTestPriceOrder(14, LIMIT, SELL, 11, 4));
  orderedQueue.append(createTestPriceOrder(15, LIMIT, SELL, 11, 5));

  orderedQueue.append(createTestPriceOrder(21, LIMIT, SELL, 22, 1));
  orderedQueue.append(createTestPriceOrder(22, LIMIT, SELL, 22, 2));
  orderedQueue.append(createTestPriceOrder(23, LIMIT, SELL, 22, 3));
  orderedQueue.append(createTestPriceOrder(24, LIMIT, SELL, 22, 4));
  orderedQueue.append(createTestPriceOrder(25, LIMIT, SELL, 22, 5));

  expect([...orderedQueue].map((order) => order.id)).toStrictEqual([
    21, 22, 23, 24, 25, 11, 12, 13, 14, 15,
  ]);
});
