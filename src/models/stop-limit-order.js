const Order = require("./order");
const { STOP_LIMIT } = require("../constants");

class StopLimitOrder extends Order {
  constructor(symbol, id, side, stop, price, amount) {
    super(symbol, id, STOP_LIMIT, side, price, amount);
    this.stop = stop;
  }
}

module.exports = StopLimitOrder;
