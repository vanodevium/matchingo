/**
 * Rejections: every error code, and the guarantee that a rejected command
 * changes nothing. Instrument rules and precision limits.
 */

import { BUY, FOK, GTD, IOC, SELL } from "../src/constants.js";
import { ErrorCode, MatchingoError } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { MemoryWal } from "../src/wal.js";
import { DecimalScales, TestScales, TestSymbol } from "./constants.js";

let m;

beforeEach(() => {
	m = new Matchingo(TestSymbol, { ...TestScales, clock: () => 1000 });
});

const code = (fn) => {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(MatchingoError);
		return error.code;
	}
	return null;
};

// ---------------------------------------------------------------------------
// Order checks
// ---------------------------------------------------------------------------

test("invalid side", () => {
	const order = m.newLimitOrder(1, 7, 10, 1);
	expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_SIDE);
});

test("invalid quantity and price on creation", () => {
	expect(code(() => m.newLimitOrder(1, BUY, 10, 0))).toBe(
		ErrorCode.INVALID_QUANTITY,
	);
	expect(code(() => m.newLimitOrder(1, BUY, 0, 1))).toBe(
		ErrorCode.INVALID_PRICE,
	);
	expect(code(() => m.newMarketOrder(1, BUY, -1))).toBe(
		ErrorCode.INVALID_QUANTITY,
	);
	expect(code(() => m.newStopMarketOrder(1, BUY, 0, 1))).toBe(
		ErrorCode.INVALID_PRICE,
	);
});

test("invalid quantity set on the order", () => {
	const order = m.newLimitOrder(1, BUY, 10, 1);
	order.amount = order.open = 0;
	expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_QUANTITY);
});

test("precision limits", () => {
	m = new Matchingo(TestSymbol, DecimalScales);
	expect(code(() => m.newLimitOrder(1, BUY, 1.0001, 1))).toBe(
		ErrorCode.PRICE_PRECISION,
	);
	expect(code(() => m.newLimitOrder(1, BUY, 1, 0.0001))).toBe(
		ErrorCode.QUANTITY_PRECISION,
	);
	expect(code(() => m.newMarketBuyQuoteOrder(1, 0.0001))).toBe(
		ErrorCode.QUANTITY_PRECISION,
	);
});

test("unknown time in force", () => {
	const order = m.newLimitOrder(1, BUY, 10, 1).setTIF(999);
	expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_TIF);
});

test("an already canceled order", () => {
	const order = m.newLimitOrder(1, BUY, 10, 1);
	order.canceled = true;
	expect(code(() => m.submit(order))).toBe(ErrorCode.ALREADY_CANCELED);
});

test("a stop price is checked too", () => {
	m = new Matchingo(TestSymbol, {
		...TestScales,
		instrument: { tickSize: 5 },
	});
	expect(code(() => m.submit(m.newStopMarketOrder(1, BUY, 12, 1)))).toBe(
		ErrorCode.TICK_SIZE,
	);
});

test("a rejected order changes nothing and is not logged", () => {
	const wal = new MemoryWal();
	m = new Matchingo(TestSymbol, { ...TestScales, wal });
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	const before = JSON.stringify(m.dump());
	const logged = wal.text;

	expect(code(() => m.submit(m.newLimitOrder(1, SELL, 10, 5)))).toBe(
		ErrorCode.DUPLICATE_ORDER_ID,
	);
	expect(code(() => m.submit(m.newLimitOrder(2, 9, 10, 5)))).toBe(
		ErrorCode.INVALID_SIDE,
	);

	expect(JSON.stringify(m.dump())).toBe(before);
	expect(wal.text).toBe(logged);
});

// ---------------------------------------------------------------------------
// Instrument
// ---------------------------------------------------------------------------

describe("instrument", () => {
	beforeEach(() => {
		m = new Matchingo(TestSymbol, {
			priceScale: 2,
			amountScale: 2,
			instrument: {
				tickSize: 0.05,
				lotSize: 0.1,
				minQuantity: 0.2,
				maxQuantity: 5,
				minPrice: 1,
				maxPrice: 100,
			},
		});
	});

	const limit = (price, amount) =>
		code(() => m.submit(m.newLimitOrder(Math.random(), BUY, price, amount)));

	test("accepts a valid order", () => {
		expect(limit(10.05, 1)).toBeNull();
		expect(limit(1, 0.2)).toBeNull();
		expect(limit(100, 5)).toBeNull();
	});

	test("tick size", () => {
		expect(limit(10.03, 1)).toBe(ErrorCode.TICK_SIZE);
	});

	test("lot size", () => {
		expect(limit(10, 1.05)).toBe(ErrorCode.LOT_SIZE);
	});

	test("quantity range", () => {
		expect(limit(10, 0.1)).toBe(ErrorCode.QUANTITY_RANGE);
		expect(limit(10, 5.1)).toBe(ErrorCode.QUANTITY_RANGE);
	});

	test("price band", () => {
		expect(limit(0.95, 1)).toBe(ErrorCode.PRICE_BAND);
		expect(limit(100.05, 1)).toBe(ErrorCode.PRICE_BAND);
	});

	test("stop-limit checks both prices", () => {
		expect(code(() => m.submit(m.newStopLimitOrder(1, BUY, 10, 200, 1)))).toBe(
			ErrorCode.PRICE_BAND,
		);
		expect(
			code(() => m.submit(m.newStopLimitOrder(1, BUY, 10.01, 10, 1))),
		).toBe(ErrorCode.TICK_SIZE);
	});

	test("iceberg: visible and hidden slices follow the lot size", () => {
		const bad = m.newIcebergOrder(1, BUY, 10, 3, 0.15);
		expect(code(() => m.submit(bad))).toBe(ErrorCode.LOT_SIZE);
		const good = m.newIcebergOrder(2, BUY, 10, 3, 0.5);
		expect(code(() => m.submit(good))).toBeNull();
	});

	test("iceberg: the quantity range is checked against the total", () => {
		const big = m.newIcebergOrder(1, BUY, 10, 5.5, 0.5);
		expect(code(() => m.submit(big))).toBe(ErrorCode.QUANTITY_RANGE);
	});

	test("quote orders are exempt from the quantity rules", () => {
		expect(code(() => m.submit(m.newMarketBuyQuoteOrder(1, 0.01)))).toBeNull();
	});

	test("zero fields are not checked", () => {
		m = new Matchingo(TestSymbol, {
			priceScale: 2,
			amountScale: 2,
			instrument: { tickSize: 0, minPrice: 0 },
		});
		expect(limit(0.01, 0.01)).toBeNull();
	});
});

test("an inconsistent instrument is refused", () => {
	const create = (instrument) => () =>
		new Matchingo(TestSymbol, { ...TestScales, instrument });
	expect(code(create({ tickSize: -1 }))).toBe(ErrorCode.INVALID_INSTRUMENT);
	expect(code(create({ minQuantity: 5, maxQuantity: 2 }))).toBe(
		ErrorCode.INVALID_INSTRUMENT,
	);
	expect(code(create({ minPrice: 5, maxPrice: 2 }))).toBe(
		ErrorCode.INVALID_INSTRUMENT,
	);
	expect(code(create({ lotSize: "abc" }))).toBe(ErrorCode.INVALID_INSTRUMENT);
});

// ---------------------------------------------------------------------------
// Time in force
// ---------------------------------------------------------------------------

describe("time in force rules", () => {
	test("GTD needs an expiry", () => {
		const order = m.newLimitOrder(1, BUY, 10, 1).setTIF(GTD);
		expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_TIF);
	});

	test("an expiry works only with GTD", () => {
		const order = m.newLimitOrder(1, BUY, 10, 1).setExpiry(5000).setTIF(IOC);
		expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_TIF);
	});

	test("a TTL works only with GTC", () => {
		const ioc = m.newLimitOrder(1, BUY, 10, 1).setTTL(100).setTIF(IOC);
		expect(code(() => m.submit(ioc))).toBe(ErrorCode.INVALID_TIF);
		const gtd = m.newLimitOrder(2, BUY, 10, 1).setExpiry(5000).setTTL(100);
		expect(code(() => m.submit(gtd))).toBe(ErrorCode.INVALID_TIF);
	});

	test("market orders do not expire", () => {
		expect(code(() => m.submit(m.newMarketOrder(1, BUY, 1).setTTL(100)))).toBe(
			ErrorCode.INVALID_TIF,
		);
		expect(
			code(() => m.submit(m.newMarketOrder(2, BUY, 1).setExpiry(5000))),
		).toBe(ErrorCode.INVALID_TIF);
	});

	test("an expiry in the past is rejected", () => {
		expect(
			code(() => m.submit(m.newLimitOrder(1, BUY, 10, 1).setExpiry(1000))),
		).toBe(ErrorCode.ORDER_EXPIRED);
		expect(
			code(() => m.submit(m.newLimitOrder(2, BUY, 10, 1).setExpiry(1001))),
		).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Self-trade prevention settings
// ---------------------------------------------------------------------------

describe("stp settings", () => {
	test("a mode needs a trader", () => {
		const order = m.newLimitOrder(1, BUY, 10, 1);
		order.stp = Matchingo.STP_CANCEL_NEWEST;
		expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_STP);
	});

	test("an unknown mode", () => {
		const order = m.newLimitOrder(1, BUY, 10, 1).setSTP("a", 42);
		expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_STP);
	});

	test("FOK can not be combined with stp", () => {
		const order = m
			.newLimitOrder(1, BUY, 10, 1)
			.setSTP("a", Matchingo.STP_CANCEL_NEWEST)
			.setTIF(FOK);
		expect(code(() => m.submit(order))).toBe(ErrorCode.INVALID_STP);
	});
});

// ---------------------------------------------------------------------------
// Halt
// ---------------------------------------------------------------------------

test("a halted book rejects new orders and amendments", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.submit(m.newStopLimitOrder(2, BUY, 20, 21, 5));
	m.halt();

	expect(code(() => m.submit(m.newLimitOrder(3, BUY, 10, 1)))).toBe(
		ErrorCode.TRADING_HALTED,
	);
	expect(code(() => m.replace(1, m.newLimitOrder(1, BUY, 11, 5)))).toBe(
		ErrorCode.TRADING_HALTED,
	);
	expect(code(() => m.modify(1, 10, 4))).toBe(ErrorCode.TRADING_HALTED);
	expect(code(() => m.modifyStop(2, 20, 21, 4))).toBe(ErrorCode.TRADING_HALTED);
});

test("a halted book still cancels and keeps its contents", () => {
	m.submit(m.newLimitOrder(1, BUY, 10, 5));
	m.submit(m.newLimitOrder(2, BUY, 9, 5));
	m.halt();

	expect(m.cancel(1)).toBe(true);
	expect(m.order(2)).toBeTruthy();
	expect(m.bestBid()).toEqual({ price: 9, amount: 5 });

	m.resume();
	expect(m.submit(m.newLimitOrder(3, BUY, 10, 1)).stored).toBe(true);
});
