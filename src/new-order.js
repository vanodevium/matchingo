const { TestSymbol, MARKET, LIMIT, MARKET_PRICE } = require("./constants");
const Order = require("./models/order");
const StopLimitOrder = require("./models/stop-limit-order");

function createTestPriceOrder(id, type, side, price, amount) {
  return createOrder(TestSymbol, id, type, side, price, amount);
}

function createTestStopLimitPrice(id, side, stop, price, amount) {
  return new StopLimitOrder(TestSymbol, id, side, stop, price, amount);
}

function createOrder(symbol, id, type, side, price, amount) {
  return new Order(symbol, id, type, side, price, amount);
}

function createMarketOrder(symbol, id, side, amount) {
  return new Order(symbol, id, MARKET, side, MARKET_PRICE, amount);
}

function createLimitOrder(symbol, id, side, price, amount) {
  return new Order(symbol, id, LIMIT, side, price, amount);
}

function createStopLimitOrder(symbol, id, side, stop, price, amount) {
  return new StopLimitOrder(symbol, id, side, stop, price, amount);
}

module.exports = {
  createMarketOrder,
  createLimitOrder,
  createStopLimitOrder,
  createTestPriceOrder,
  createTestStopLimitPrice,
};
