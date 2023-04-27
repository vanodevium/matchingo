const {
  BUY,
  SELL,
  MARKET,
  LIMIT,
  STOP_LIMIT,
  GTC,
  TAKER,
  MAKER,
} = require("../constants");

class Order {
  constructor(symbol, id, type, side, price, amount) {
    this.id = id;
    this.type = type;
    this.side = side;
    this.symbol = symbol;
    this.price = price;
    this.amount = amount;

    this.open_amount = amount;

    this.oco = null;
    this.tif = GTC;

    this.setTaker();

    this.tradePrice = 0;
    this.tradeAmount = 0;

    this.setAutoStatus();

    this.deleted = false;
    this.canceled = false;
    this.activated = false;

    this._isQuote = false;
  }

  isMaker() {
    return MAKER === this.role;
  }

  hasSymbol(symbol) {
    return this.symbol === symbol;
  }

  isBuy() {
    return this.side === BUY;
  }

  isSell() {
    return this.side === SELL;
  }

  isMarket() {
    return MARKET === this.type;
  }

  isLimit() {
    return LIMIT === this.type;
  }

  isStopLimit() {
    return STOP_LIMIT === this.type;
  }

  isQuote() {
    return this._isQuote;
  }

  getKey() {
    return this.id;
  }

  oppositeSide() {
    if (this.isBuy()) {
      return SELL;
    }

    if (this.isSell()) {
      return BUY;
    }
  }

  increase(amount, price, isQuote) {
    if (amount === 0) {
      return false;
    }

    if (this.isQuote() || isQuote) {
      amount = amount / price;
    }

    this.open_amount -= amount;
    this.tradeAmount += amount;

    if (this.open_amount < 0) {
      throw new Error("open amount is less then zero: " + JSON.stringify(this));
    }

    this.setAutoStatus();

    return true;
  }

  setAutoStatus() {
    if (this.open_amount > this.amount) {
      throw new Error("open_amount is greater than amount");
    }

    if (this.isOpen()) {
      this.status = "open";
    }

    if (this.isPartial()) {
      if (this.isFulfilled()) {
        this.status = "fulfilled";
      } else {
        this.status = "partial";
      }
    }
  }

  setTIF(tif) {
    this.tif = tif;
  }

  setMaker() {
    this.role = MAKER;
  }

  setTaker() {
    this.role = TAKER;
  }

  setOCO(id) {
    this.oco = id;
  }

  setQuoteMode() {
    if (this.isMarket()) {
      this._isQuote = true;
    }
  }

  getMaxAmount(amount) {
    if (this.open_amount < amount) {
      return this.open_amount;
    }

    return amount;
  }

  isFulfilled() {
    return 0 === this.open_amount;
  }

  isOpen() {
    return this.amount === this.open_amount;
  }

  isPartial() {
    return this.amount > this.open_amount;
  }

  cancel() {
    this.canceled = true;
  }

  isCanceled() {
    return this.canceled;
  }

  delete() {
    this.deleted = true;
  }

  isDeleted() {
    return this.deleted;
  }

  activate() {
    this.type = LIMIT;
    this.activated = true;
  }

  isActivated() {
    return this.activated;
  }

  resetTrade() {
    this.tradeAmount = 0;
    this.tradePrice = 0;
  }
}

module.exports = Order;
