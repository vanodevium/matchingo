class OrdersCollection {
  constructor() {
    this.orders = new Set();
  }

  reset() {
    this.orders = new Set();
  }

  append(order) {
    this.orders.add(order);
  }

  has(order) {
    return this.orders.has(order);
  }

  size() {
    return this.orders.size;
  }

  remove(order) {
    this.orders.delete(order);
  }

  toArray() {
    return Array.from(this.orders);
  }
}

module.exports = OrdersCollection;
