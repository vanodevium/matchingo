class LastPrice {
  constructor(symbol) {
    this.symbol = symbol;
    this.last = {
      [this.symbol]: 0,
    };
  }

  set(price) {
    if (price) {
      this.last[this.symbol] = price;
    }
  }

  get() {
    return this.last[this.symbol];
  }

  getRaw() {
    return this.last;
  }
}

module.exports = LastPrice;
