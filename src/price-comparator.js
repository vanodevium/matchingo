class PriceComparator {
  compare(a, b) {
    if (a.isMarket() && b.isMarket()) {
      throw new Error("MARKET-MARKET can not be matched");
    }

    if (a.isLimit() && b.isLimit()) {
      return this._getLimitLimitPrice(a, b);
    }

    if (a.isMarket() && b.isLimit()) {
      return this._getMarketLimitPrice(a, b);
    }

    if (a.isLimit() && b.isMarket()) {
      return this._getMarketLimitPrice(b, a);
    }
  }

  _getMarketLimitPrice(market, limit) {
    if (market.isMarket() && limit.isLimit()) {
      return limit.price;
    }

    throw new Error("MARKET-LIMIT pricing problem");
  }

  _getLimitLimitPrice(newOrder, orderFromOrderBook) {
    if (newOrder.isLimit() && orderFromOrderBook.isLimit()) {
      if (newOrder.isBuy() && orderFromOrderBook.price <= newOrder.price) {
        return orderFromOrderBook.price;
      }

      if (newOrder.isSell() && orderFromOrderBook.price >= newOrder.price) {
        return orderFromOrderBook.price;
      }

      return 0;
    }

    throw new Error("LIMIT-LIMIT pricing problem");
  }
}

module.exports = PriceComparator;
