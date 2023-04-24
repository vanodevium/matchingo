const { LIMIT } = require("./constants");
const OrderedOrders = require("./ordered-set-orders-queue");

class StopBook {
  constructor(symbol) {
    this.symbol = symbol;
    this.orders = {
      [this.symbol]: new OrderedOrders("ASC", "stop"),
    };
  }

  getRaw() {
    return {
      [this.symbol]: this.orders[this.symbol].getRaw(),
    };
  }

  getOrders(symbol, price) {
    return this.orders[this.symbol].getOrders(price);
  }

  append(order) {
    this.orders[order.symbol].append(order);
  }

  remove(order) {
    return this.orders[order.symbol].remove(order);
  }

  activate(symbol, currentPrice) {
    const activated = [];

    const orders = this.orders[this.symbol].orders[currentPrice];
    if (!orders) {
      return activated;
    }

    let stopLimit;
    while ((stopLimit = orders.shift())) {
      stopLimit.type = LIMIT;
      stopLimit.activate();
      activated.push(stopLimit);
    }

    delete this.orders[this.symbol].orders[currentPrice];

    return activated;
  }

  cancel(symbol, key) {
    const order = this.orders[this.symbol].find(key);
    if (order) {
      this.orders[this.symbol].cancel(key);
      return order;
    }
    return false;
  }
}

module.exports = StopBook;
