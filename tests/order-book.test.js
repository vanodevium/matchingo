import { BUY, BUY_KEY, LIMIT, SELL, SELL_KEY } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import OrderBook from "../src/order-book.js";
import { createTestPriceOrder, TestSymbol } from "./constants.js";

let matchingo;

beforeEach(() => {
	matchingo = new Matchingo(TestSymbol);
});

test("order book instance: duplicates", () => {
	const orderBook = new OrderBook(TestSymbol);
	orderBook.append(createTestPriceOrder(1, LIMIT, BUY, 11, 100));
	orderBook.append(createTestPriceOrder(1, LIMIT, BUY, 11, 100));

	expect(Object.keys(orderBook.getRaw()[TestSymbol][BUY_KEY])).toStrictEqual([
		"11",
	]);

	Object.values(orderBook.getRaw()[TestSymbol][BUY_KEY]).forEach((queue) => {
		expect(queue.length).toBe(1);
	});
});

test("order book: duplicates", () => {
	matchingo.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));
	matchingo.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));

	expect(
		Object.keys(matchingo.orderBook.getRaw()[TestSymbol][BUY_KEY]),
	).toStrictEqual(["11"]);

	Object.values(matchingo.orderBook.getRaw()[TestSymbol][BUY_KEY]).forEach(
		(queue) => {
			expect(queue.length).toBe(1);
		},
	);
});

test("order book: getRaw buy", () => {
	matchingo.process(createTestPriceOrder(1, LIMIT, BUY, 11, 100));
	matchingo.process(createTestPriceOrder(2, LIMIT, BUY, 12, 200));
	matchingo.process(createTestPriceOrder(3, LIMIT, BUY, 13, 300));

	expect(
		Object.keys(matchingo.orderBook.getRaw()[TestSymbol][BUY_KEY]),
	).toStrictEqual(["11", "12", "13"]);

	Object.values(matchingo.orderBook.getRaw()[TestSymbol][BUY_KEY]).forEach(
		(queue) => {
			expect(queue.length).toBe(1);
		},
	);
});

test("order book: getRaw sell", () => {
	matchingo.process(createTestPriceOrder(1, LIMIT, SELL, 11, 100));
	matchingo.process(createTestPriceOrder(2, LIMIT, SELL, 12, 200));
	matchingo.process(createTestPriceOrder(3, LIMIT, SELL, 13, 300));

	expect(
		Object.keys(matchingo.orderBook.getRaw()[TestSymbol][SELL_KEY]),
	).toStrictEqual(["11", "12", "13"]);
	Object.values(matchingo.orderBook.getRaw()[TestSymbol][SELL_KEY]).forEach(
		(queue) => {
			expect(queue.length).toBe(1);
		},
	);
});
