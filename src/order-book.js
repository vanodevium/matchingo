const { SELL, BUY } = require("./constants");
const OrderedOrders = require("./ordered-set-orders-queue");
const Volume = require("./volume");
const PriceComparator = require("./price-comparator");
const LastPrice = require("./last");

class OrderBook {
  constructor(symbol) {
    this.symbol = symbol;
    this.orders = {
      [this.symbol]: {
        [SELL]: new OrderedOrders("ASC", "price"),
        [BUY]: new OrderedOrders("DESC", "price"),
      },
    };
    this.volume = new Volume(this.symbol);
    this.comparator = new PriceComparator();
    this.lastPrice = new LastPrice(this.symbol);
  }

  getRaw() {
    return {
      [this.symbol]: {
        [SELL]: this.orders[this.symbol][SELL].getRaw(),
        [BUY]: this.orders[this.symbol][BUY].getRaw(),
      },
    };
  }

  getOrders(symbol, side, price) {
    return this.orders[this.symbol][side].getOrders(price);
  }

  getBestQueue(order) {
    return this.orders[order.symbol][order.oppositeSide()].getBestQueue();
  }

  append(order) {
    if (order.isMarket()) {
      throw new Error("MARKET can not be appended to the order book");
    }
    return this.orders[order.symbol][order.side].append(order);
  }

  remove(order) {
    if (order.isMarket()) {
      return false;
    }
    return this.orders[order.symbol][order.side].remove(order);
  }

  fastRemove(order) {
    if (order.isMarket()) {
      return false;
    }
    return this.orders[order.symbol][order.side].fastRemove(order);
  }

  find(symbol, key) {
    return (
      this.orders[this.symbol][SELL].find(key) ||
      this.orders[this.symbol][BUY].find(key)
    );
  }
}

module.exports = OrderBook;
