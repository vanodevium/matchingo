import {
	BUY,
	GTC,
	GTD,
	LIMIT,
	MARKET,
	SELL,
	STOP_LIMIT,
	STOP_MARKET,
	STP_NONE,
	TRAILING_STOP,
} from "../constants.js";

const RECORD_FIELDS = [
	"id",
	"type",
	"side",
	"price",
	"stop",
	"amount",
	"open",
	"shown",
	"peak",
	"tif",
	"expiry",
	"ttl",
	"oco",
	"traderID",
	"stp",
	"postOnly",
	"quote",
	"toLimit",
	"trailOffset",
	"trailPercent",
	"timestamp",
	"seq",
];

export default class Order {
	/**
	 * Amounts are scaled integers. `amount` is the quantity of this run,
	 * `open` is what is still unfilled (visible and hidden), `shown` is the
	 * part visible in the book.
	 */
	constructor(symbol, id, type, side, price, amount) {
		this.id = id;
		this.symbol = symbol;
		this.type = type;
		this.side = side;
		this.opposite = side === BUY ? SELL : BUY;
		this.price = price;
		this.stop = 0;
		this.amount = amount;
		this.open = amount;
		this.shown = amount;
		this.peak = 0;

		this.tif = GTC;
		this.expiry = 0;
		this.ttl = 0;
		this.oco = null;
		this.traderID = null;
		this.stp = STP_NONE;

		this.postOnly = false;
		this.quote = false;
		this.toLimit = false;
		this.trailOffset = 0;
		this.trailPercent = 0;

		this.timestamp = 0;
		this.seq = 0;
		this.canceled = false;
	}

	/**
	 * Restore an order from the plain data of toRecord().
	 * @param {string} symbol
	 * @param {object} record
	 * @returns {Order}
	 */
	static fromRecord(symbol, record) {
		const order = new Order(
			symbol,
			record.id,
			record.type,
			record.side,
			record.price,
			record.amount,
		);
		for (const field of RECORD_FIELDS) {
			if (record[field] !== undefined) {
				order[field] = record[field];
			}
		}
		return order;
	}

	toRecord() {
		const record = {};
		for (const field of RECORD_FIELDS) {
			record[field] = this[field];
		}
		return record;
	}

	oppositeSide() {
		return this.opposite;
	}

	isMarket() {
		return MARKET === this.type;
	}

	isLimit() {
		return LIMIT === this.type;
	}

	isStop() {
		return (
			this.type === STOP_LIMIT ||
			this.type === STOP_MARKET ||
			this.type === TRAILING_STOP
		);
	}

	isQuote() {
		return this.quote;
	}

	hiddenAmount() {
		return this.open - this.shown;
	}

	setTIF(tif) {
		this.tif = tif;
		return this;
	}

	setOCO(id) {
		this.oco = id;
		return this;
	}

	/**
	 * Self-trade prevention: orders with the same traderID do not trade
	 * with each other; the mode decides what happens instead.
	 */
	setSTP(traderID, mode) {
		this.traderID = traderID;
		this.stp = mode;
		return this;
	}

	/**
	 * Good-till-date: unix ms timestamp at which the order is canceled.
	 */
	setExpiry(timestamp) {
		this.expiry = timestamp;
		this.tif = GTD;
		return this;
	}

	/**
	 * Good-till-date: the order lives this many ms from the moment it is accepted.
	 */
	setTTL(ms) {
		this.ttl = ms;
		return this;
	}
}
