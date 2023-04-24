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
  constructor(type, side, symbol, price, amount, ms) {
    this.ID = ms || Date.now();
    this.type = type;
    this.side = side;
    this.symbol = symbol;
    this.price = type === MARKET ? 0 : price;
    this.amount = amount;
    this.open_amount = amount;
    this.ms = ms || Date.now();
    this.status = "open";
    this.tradePrice = 0;
    this.tradeAmount = 0;
    this.oco = null;
    this.tif = GTC;
    this.role = TAKER;

    this.deleted = false;
    this.canceled = false;
    this.activated = false;
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
    return this.isMarket() && this.isBuy();
  }

  getKey() {
    return this.ID;
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
      throw new Error("open amount is less then zero: " + this.toString());
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

  setRole(role) {
    this.role = role;
  }

  getAvailableAmount(amount) {
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
    this.activated = true;
  }

  isActivated() {
    return this.activated;
  }

  toString() {
    return [
      this.type,
      this.side,
      this.symbol,
      this.price,
      this.amount,
      this.open_amount,
      this.ms,
      this.status,
      this.tradePrice,
    ].join("|");
  }
}

module.exports = Order;
