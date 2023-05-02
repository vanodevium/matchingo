const { SELL, BUY } = require("./constants");
const OrderedOrders = require("./ordered-set-orders-queue");
const Volume = require("./volume");
const PriceComparator = require("./price-comparator");

class OrderBook {
  constructor(symbol) {
    this.symbol = symbol;
    this[SELL] = new OrderedOrders("ASC", "price");
    this[BUY] = new OrderedOrders("DESC", "price");
    this.volume = new Volume(this.symbol);
    this.comparator = new PriceComparator();
  }

  next(order) {
    return this[order.oppositeSide()].next();
  }

  append(order) {
    if (order.isMarket()) {
      throw new Error("MARKET can not be appended to the order book");
    }
    return this[order.side].append(order);
  }

  remove(order) {
    if (order.isMarket()) {
      return false;
    }
    return this[order.side].remove(order);
  }

  fastRemove(order) {
    if (order.isMarket()) {
      return false;
    }
    return this[order.side].fastRemove(order);
  }

  find(key) {
    return this[SELL].find(key) || this[BUY].find(key);
  }

  cancel(key) {
    return this[SELL].cancel(key) || this[BUY].cancel(key);
  }

  getRaw() {
    return {
      [this.symbol]: {
        [SELL]: this[SELL].getRaw(),
        [BUY]: this[BUY].getRaw(),
      },
    };
  }
}

module.exports = OrderBook;
