const createTree = require("functional-red-black-tree");
const DenQueue = require("denque");

class OrderedSetOrdersQueue {
  constructor(sort, key = "price") {
    this.key = key;
    this.orders = {};
    this.unique = {};
    switch ((sort || "").toLowerCase()) {
      case "asc":
        this.prices = createTree((a, b) => a - b);
        break;
      case "desc":
        this.prices = createTree((a, b) => b - a);
        break;
      default:
        throw new Error("set sorting");
    }
  }

  append(order) {
    if (this.unique[order.getKey()]) {
      return false;
    }

    this.unique[order.getKey()] = order;

    const exist = this.orders[order[this.key]];

    if (exist) {
      exist.push(order);
      return true;
    }

    const orders = new DenQueue();
    orders.push(order);
    this.orders[order[this.key]] = orders;
    this.prices = this.prices.insert(order[this.key]);

    return true;
  }

  remove(order) {
    if (!this.unique[order.getKey()]) {
      return false;
    }

    if (this.orders[order[this.key]]) {
      const orders = this.orders[order[this.key]];
      for (let index = 0; index < orders.length; index++) {
        const element = orders.peekAt(index);
        if (element && element.getKey() === order.getKey()) {
          orders.removeOne(index);
          delete this.unique[order.getKey()];
          if (orders.isEmpty()) {
            delete this.orders[order[this.key]];
            this.prices = this.prices.remove(order[this.key]);
            return true;
          }
        }
      }
    }

    return false;
  }

  fastRemove(order) {
    delete this.unique[order.getKey()];
    const price = order[this.key];
    this.orders[price].shift();
    if (this.orders[price].isEmpty()) {
      delete this.orders[price];
      this.prices = this.prices.remove(price);
      return true;
    }

    return false;
  }

  find(key) {
    return this.unique[key] || false;
  }

  cancel(key) {
    const order = this.find(key);
    if (order) {
      return this.remove(order);
    }
    return false;
  }

  getBestQueue() {
    if (this.prices.length) {
      return this.orders[this.prices.at(0)?.key] || false;
    }
    return false;
  }

  getOrders(price) {
    return this.orders[price] || [];
  }

  getRaw() {
    return this.orders;
  }
}

module.exports = OrderedSetOrdersQueue;
