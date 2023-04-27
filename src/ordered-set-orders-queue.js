const createTree = require("functional-red-black-tree");
const DenQueue = require("denque");

class OrderedSetOrdersQueue {
  constructor(sort, key = "price") {
    this.key = key;
    this.unique = {};
    switch ((sort || "").toLowerCase()) {
      case "asc":
        this.priceOrdersTreeMap = createTree((a, b) => a - b);
        break;
      case "desc":
        this.priceOrdersTreeMap = createTree((a, b) => b - a);
        break;
      default:
        throw new Error("set sorting");
    }
  }

  /**
   * @param {Order} order
   * @returns {boolean}
   */
  append(order) {
    if (this.unique[order.getKey()]) {
      return false;
    }

    order.setMaker();

    this.unique[order.getKey()] = order;

    const price = order[this.key];
    let queue = this.priceOrdersTreeMap.get(price);

    if (!queue) {
      queue = new DenQueue();
      this.priceOrdersTreeMap = this.priceOrdersTreeMap.insert(price, queue);
    }

    queue.push(order);

    return true;
  }

  /**
   * @param {Order} order
   * @returns {boolean}
   */
  remove(order) {
    if (!this.unique[order.getKey()]) {
      return false;
    }

    const price = order[this.key];
    const queue = this.priceOrdersTreeMap.get(price);

    if (!queue) {
      return false;
    }

    for (let index = 0; index < queue.length; index++) {
      const element = queue.peekAt(index);
      if (element && element.getKey() === order.getKey()) {
        queue.removeOne(index);
        delete this.unique[order.getKey()];
        if (queue.isEmpty()) {
          this.priceOrdersTreeMap = this.priceOrdersTreeMap.remove(price);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * @param {Order} order
   * @returns {boolean}
   */
  fastRemove(order) {
    delete this.unique[order.getKey()];
    const iter = this.priceOrdersTreeMap.begin;
    iter.value.shift();
    if (iter.value.isEmpty()) {
      iter.remove();
      return true;
    }

    return false;
  }

  /**
   * @param {string|number} key
   * @returns {Order|boolean}
   */
  find(key) {
    return this.unique[key] || false;
  }

  /**
   * @param {string|number} key
   * @returns {boolean}
   */
  cancel(key) {
    const order = this.find(key);
    if (order) {
      return this.remove(order);
    }
    return false;
  }

  getBestIterator() {
    return this.priceOrdersTreeMap.begin;
  }

  /**
   * @param {Number} price
   * @returns {DenQueue|Array}
   */
  getOrders(price) {
    return this.priceOrdersTreeMap.get(price) || [];
  }

  getRaw() {
    const obj = {};
    this.priceOrdersTreeMap.forEach(function (key, value) {
      obj[key] = value;
    });
    return obj;
  }
}

module.exports = OrderedSetOrdersQueue;
