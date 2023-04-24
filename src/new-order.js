const { Symbol, STOP_LIMIT } = require("./constants");
const Order = require("./models/order");
const StopLimitOrder = require("./models/stop-limit-order");

function createTestPriceOrder(id, type, side, price, amount) {
  return new Order(type, side, Symbol, price, amount, id);
}

function createTestStopLimitPrice(id, side, stop, price, amount) {
  return new StopLimitOrder(STOP_LIMIT, side, Symbol, stop, price, amount, id);
}

module.exports = {
  createTestPriceOrder,
  createTestStopLimitPrice,
};
