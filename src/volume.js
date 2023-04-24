const { sum } = require("lodash");
const { BUY, SELL } = require("./constants");
const Numbers = require("./ordered-set-numbers");

class Volume {
  constructor(symbol) {
    this.symbol = symbol;
    this.volume = {
      [this.symbol]: {
        [BUY]: new Numbers("DESC"),
        [SELL]: new Numbers("ASC"),
      },
    };
  }

  increase(order, price, amount) {
    if (order.isMarket()) {
      return;
    }
    this.volume[this.symbol][order.side].increase(price, amount);
  }

  decrease(order, price, amount) {
    if (order.isMarket()) {
      return;
    }
    this.volume[this.symbol][order.side].decrease(price, amount);
  }

  get(side) {
    return sum(Object.values(this.volume[this.symbol][side].getRaw()));
  }

  hasEnough(side, price, amount) {
    const volume = this.volume[this.symbol][side].getRaw();
    const prices = this.volume[this.symbol][side].geyKeys();

    if (SELL === side) {
      return this._hasEnough(
        price,
        amount,
        prices,
        volume,
        (bestPrice, orderPrice) => orderPrice >= bestPrice
      );
    }

    if (BUY === side) {
      return this._hasEnough(
        price,
        amount,
        prices,
        volume,
        (bestPrice, orderPrice) => orderPrice <= bestPrice
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

  getRaw() {
    return {
      [this.symbol]: {
        [BUY]: this.volume[this.symbol][BUY].getRaw(),
        [SELL]: this.volume[this.symbol][SELL].getRaw(),
      },
    };
  }
}

module.exports = Volume;
