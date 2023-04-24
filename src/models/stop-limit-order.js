const Order = require("./order");

class StopLimitOrder extends Order {
  constructor(type, side, symbol, stop, price, amount, ms) {
    super(type, side, symbol, price, amount, ms);
    this.stop = stop;
  }
}

module.exports = StopLimitOrder;
