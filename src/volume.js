const { BUY, SELL } = require("./constants");
const Numbers = require("./ordered-set-numbers");

class Volume {
  constructor(symbol) {
    this.symbol = symbol;
    this[SELL] = new Numbers("ASC");
    this[BUY] = new Numbers("DESC");
  }

  increase(order, price, amount) {
    if (order.isMarket()) {
      return;
    }
    return this[order.side].increase(price, amount);
  }

  decrease(order, price, amount) {
    if (order.isMarket()) {
      return;
    }
    return this[order.side].decrease(price, amount);
  }

  get(side) {
    let sum = 0;
    Object.values(this[side].getRaw() || {}).forEach((val) => (sum += val));
    return sum;
  }

  hasEnough(side, price, amount) {
    const volume = this[side].getRaw();
    const prices = this[side].geyKeys();

    if (SELL === side) {
      return this._hasEnough(
        price,
        amount,
        prices,
        volume,
        (bestPrice, orderPrice) => orderPrice >= bestPrice,
      );
    }

    if (BUY === side) {
      return this._hasEnough(
        price,
        amount,
        prices,
        volume,
        (bestPrice, orderPrice) => orderPrice <= bestPrice,
      );
    }

    throw Error("hasEnough side");
  }

  _hasEnough(orderPrice, amount, prices, volume, comparator) {
    let accumulator = 0;
    prices.forEach((bestPrice) => {
      if (comparator(bestPrice, orderPrice) && accumulator < amount) {
        accumulator += volume[bestPrice];
      } else {
        return true;
      }
    });
    return accumulator >= amount;
  }

  getVolume(order) {
    return this[order.side].getVolume(order);
  }

  getRaw() {
    return {
      [this.symbol]: {
        [BUY]: this[BUY].getRaw(),
        [SELL]: this[SELL].getRaw(),
      },
    };
  }
}

module.exports = Volume;
