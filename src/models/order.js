import {
	BUY,
	GTC,
	LIMIT,
	MAKER,
	MARKET,
	SELL,
	STOP_LIMIT,
	TAKER,
} from "../constants.js";

export default class Order {
	constructor(symbol, id, type, side, price, amount, traderID = null) {
		this.id = id;
		this.type = type;
		this.side = side;
		this.symbol = symbol;
		this.price = price;
		this.amount = amount;
		this.traderID = traderID;

		this.open_amount = amount;

		this.oco = null;
		this.tif = GTC;

		this.role = TAKER;
		this.opposite = side === BUY ? SELL : BUY;

		this.tradePrice = 0;
		this.tradeAmount = 0;

		this.deleted = false;
		this.canceled = false;
		this.activated = false;

		this._isQuote = false;
		this.postOnly = false;
		this.peakAmount = 0;
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
		return this.opposite;
	}

	increase(amount) {
		if (amount === 0) {
			return false;
		}

		this.open_amount -= amount;
		this.tradeAmount += amount;

		if (this.open_amount < 0) {
			throw new Error(`open amount is less then zero: ${JSON.stringify(this)}`);
		}

		if (this.open_amount > this.amount) {
			throw new Error("open_amount is greater than amount");
		}

		if (this.open_amount === this.amount) {
			this.status = "open";
		} else if (this.amount > this.open_amount) {
			this.status = this.open_amount === 0 ? "fulfilled" : "partial";
		}

		return true;
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
		if (this.type === MARKET) {
			this._isQuote = true;
		}
	}

	getMaxAmount(amount) {
		return Math.min(this.open_amount, amount);
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
