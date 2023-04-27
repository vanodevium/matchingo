const OrderedOrders = require("./ordered-set-orders-queue");

class StopBook {
  constructor(symbol) {
    this.symbol = symbol;
    this.orders = new OrderedOrders("ASC", "stop");
  }

  getRaw() {
    return {
      [this.symbol]: this.orders.getRaw(),
    };
  }

  getOrders(symbol, price) {
    return this.orders.getOrders(price);
  }

  append(order) {
    this.orders.append(order);
  }

  remove(order) {
    return this.orders.remove(order);
  }

  activate(currentPrice) {
    const activated = [];

    const orders = this.orders.priceOrdersTreeMap.get(currentPrice);
    if (!orders) {
      return activated;
    }

    let stopLimit;
    while ((stopLimit = orders.shift())) {
      stopLimit.activate();
      activated.push(stopLimit);
    }

    this.orders.priceOrdersTreeMap =
      this.orders.priceOrdersTreeMap.remove(currentPrice);

    return activated;
  }

  cancel(key) {
    const order = this.orders.find(key);
    if (order) {
      this.orders.cancel(key);
      return order;
    }
    return false;
  }

  find(key) {
    return this.orders.find(key);
  }
}

module.exports = StopBook;
