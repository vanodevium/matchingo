export default class PriceComparator {
	compare(a, b) {
		if (a.type === 10 && b.type === 10) {
			throw new Error("MARKET-MARKET can not be matched");
		}

		if (a.type === 20 && b.type === 20) {
			return this._getLimitLimitPrice(a, b);
		}

		if (a.type === 10 && b.type === 20) {
			return this._getMarketLimitPrice(a, b);
		}

		if (a.type === 20 && b.type === 10) {
			return this._getMarketLimitPrice(b, a);
		}
	}

	_getMarketLimitPrice(market, limit) {
		if (market.type === 10 && limit.type === 20) {
			return limit.price;
		}

		throw new Error("MARKET-LIMIT pricing problem");
	}

	_getLimitLimitPrice(newOrder, orderFromOrderBook) {
		if (newOrder.type === 20 && orderFromOrderBook.type === 20) {
			if (newOrder.side === 1 && orderFromOrderBook.price <= newOrder.price) {
				return orderFromOrderBook.price;
			}

			if (newOrder.side === 2 && orderFromOrderBook.price >= newOrder.price) {
				return orderFromOrderBook.price;
			}

			return 0;
		}

		throw new Error("LIMIT-LIMIT pricing problem");
	}
}
