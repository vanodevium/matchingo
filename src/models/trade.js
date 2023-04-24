class Trade {
  constructor(tradeOrder, orders = []) {
    this.setOrder(tradeOrder);
    this.orders = [];
    this.processed = 0;
    this.processedQuote = 0;
    orders.map((order) => {
      this.appendOrder(order);
    });
    this.left = this.amount - this.processed;
    this.leftQuote = this.amount - this.processedQuote;
  }

  setOrder(order) {
    this.isQuote = order.isQuote();
    this.amount = order.amount;
    this.order = {
      id: order.ID,
      price: order.tradePrice,
      amount: order.tradeAmount,
      role: order.role,
    };
  }

  appendOrder(order) {
    this.orders.push({
      id: order.ID,
      price: order.tradePrice,
      amount: order.tradeAmount,
      role: order.role,
    });
    this.processed += order.tradeAmount;
    this.processedQuote += order.tradeAmount * order.tradePrice;
  }
}

module.exports = Trade;
