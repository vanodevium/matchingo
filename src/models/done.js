class Done {
  constructor(trade, canceled = [], activated = []) {
    this.order = trade.order;
    this.trades = trade.orders;
    this.processed = trade.processed;
    this.left = trade.left;
    this.canceled = canceled.map((o) => o.getKey());
    this.activated = activated.map((o) => o.getKey());
  }
}

module.exports = Done;
