const { Deque } = require("@js-sdsl/deque");
const { AscSortedMap, DescSortedMap } = require("./sorted-map");

/**
 * @property {AscSortedMap|DescSortedMap} ordered
 */
class OrderedSetOrdersQueue {
  constructor(sort, key = "price") {
    this.key = key;
    this.unique = {};
    switch ((sort || "").toLowerCase()) {
      case "asc":
        this.ordered = new AscSortedMap();
        break;
      case "desc":
        this.ordered = new DescSortedMap();
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
    let queue = this.ordered.get(price);

    if (!queue) {
      queue = new Deque();
      this.ordered.insert(price, queue);
    }

    queue.pushBack(order);

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
    const queue = this.ordered.get(price);

    if (!queue) {
      return false;
    }

    queue.eraseElementByValue(order);
    delete this.unique[order.getKey()];
    if (!queue.length) {
      this.ordered.remove(price);
      return true;
    }

    return false;
  }

  /**
   * @param {Order} order
   * @returns {boolean}
   */
  fastRemove(order) {
    delete this.unique[order.getKey()];
    return this.ordered.fastRemoveFirst();
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

  /**
   * @returns {{value: *, done: boolean, key: *}|{value: null, done: boolean, key: null}}
   */
  next() {
    return this.ordered.next();
  }

  /**
   * @param {Number} price
   * @returns {Deque|Array}
   */
  getOrders(price) {
    return this.ordered.get(price) || [];
  }

  getRaw() {
    return this.ordered.values;
  }

  *[Symbol.iterator]() {
    for (let price of this.ordered.keys) {
      for (let order of this.ordered.values[price]) {
        yield order;
      }
    }
  }
}

module.exports = OrderedSetOrdersQueue;
