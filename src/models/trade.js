class Trade {
  constructor(tradeOrder, orders = []) {
    this.order = null;
    this.isQuote = false;
    this.amount = 0;
    this.processed = 0;
    this.left = 0;
    this.orders = [];
    this.setOrder(tradeOrder);
    this.setOrders(orders);
  }

  setOrder(order) {
    this.isQuote = order.isQuote();
    this.amount = order.amount;
    this.order = {
      id: order.id,
      price: order.tradePrice || order.price,
      isQuote: order.isQuote(),
      amount: 0,
      role: order.role,
    };
    order.resetTrade();
  }

  setOrders(orders = []) {
    if (!orders || !orders.length) {
      return;
    }
    orders.map((order) => {
      this.appendOrder(order);
    });
    this.calculateLeft();
    this.unshiftOrder();
  }

  appendOrder(order) {
    this.orders.push({
      id: order.id,
      price: order.tradePrice,
      isQuote: order.isQuote(),
      amount: order.tradeAmount,
      role: order.role,
    });
    this.processed += order.tradeAmount * (this.isQuote ? order.tradePrice : 1);
    order.resetTrade();
  }

  unshiftOrder() {
    if (this.orders.length) {
      this.orders.unshift(this.order);
    }
  }

  calculateLeft() {
    this.order.amount = this.processed;
    this.left = this.amount - this.processed;
  }
}

module.exports = Trade;
