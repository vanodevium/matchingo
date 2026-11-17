import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import StopBook from "../src/stop-book.js";
import { TestScales, TestSymbol } from "./constants.js";

let matchingo;

beforeEach(() => {
	matchingo = new Matchingo(TestSymbol, false, TestScales);
});

test("stop book instance: activate", () => {
	const stopBook = new StopBook(TestSymbol);
	stopBook.append(matchingo.newStopLimitOrder(1, BUY, 10, 11, 100));
	stopBook.append(matchingo.newStopLimitOrder(2, BUY, 10, 12, 100));

	expect(Object.keys(stopBook.getRaw()[TestSymbol])).toStrictEqual(["10"]);

	Object.values(stopBook.getRaw()[TestSymbol]).forEach((queue) => {
		expect(queue.size()).toBe(2);
	});

	expect(stopBook.activate(9).length).toBe(0);
	expect(Object.keys(stopBook.getRaw()[TestSymbol])).toStrictEqual(["10"]);
	expect(stopBook.activate(10).length).toBe(2);
	expect(Object.keys(stopBook.getRaw()[TestSymbol])).toStrictEqual([]);
});

test("stop book instance: BUY stop activates when price is above stop", () => {
	const stopBook = new StopBook(TestSymbol);
	stopBook.append(matchingo.newStopLimitOrder(1, BUY, 10, 11, 100));
	stopBook.append(matchingo.newStopLimitOrder(2, BUY, 12, 13, 100));

	expect(stopBook.activate(11).map((o) => o.id)).toStrictEqual([1]);
	expect(Object.keys(stopBook.getRaw()[TestSymbol])).toStrictEqual(["12"]);
});

test("stop book instance: SELL stop activates when price is below stop", () => {
	const stopBook = new StopBook(TestSymbol);
	stopBook.append(matchingo.newStopLimitOrder(1, SELL, 10, 9, 100));
	stopBook.append(matchingo.newStopLimitOrder(2, SELL, 8, 7, 100));

	expect(stopBook.activate(11).length).toBe(0);
	expect(stopBook.activate(9).map((o) => o.id)).toStrictEqual([1]);
	expect(Object.keys(stopBook.getRaw()[TestSymbol])).toStrictEqual(["8"]);
});

test("stop book instance: activated order leaves the stop book", () => {
	const stopBook = new StopBook(TestSymbol);
	stopBook.append(matchingo.newStopLimitOrder(1, BUY, 10, 11, 100));

	stopBook.activate(10);
	expect(stopBook.find(1)).toBe(false);
});

test("stop book instance: BUY and SELL stops use separate sides", () => {
	const stopBook = new StopBook(TestSymbol);
	stopBook.append(matchingo.newStopLimitOrder(1, BUY, 10, 11, 1));
	stopBook.append(matchingo.newStopLimitOrder(2, SELL, 10, 9, 1));

	expect(stopBook.find(1).side).toBe(BUY);
	expect(stopBook.find(2).side).toBe(SELL);
	expect(stopBook.getOrders(TestSymbol, 10).length).toBe(2);
	// price 10 fires both; price 11 fires only the BUY stop
	expect(stopBook.activate(11).map((o) => o.id)).toStrictEqual([1]);
	expect(stopBook.activate(10).map((o) => o.id)).toStrictEqual([2]);
	expect(stopBook.isEmpty()).toBe(true);
});

test("stop book instance: activate in order of stop price and time", () => {
	const stopBook = new StopBook(TestSymbol);
	stopBook.append(matchingo.newStopLimitOrder(1, BUY, 12, 13, 1));
	stopBook.append(matchingo.newStopLimitOrder(2, BUY, 10, 11, 1));
	stopBook.append(matchingo.newStopLimitOrder(3, BUY, 10, 11, 1));
	stopBook.append(matchingo.newStopLimitOrder(4, SELL, 20, 19, 1));
	stopBook.append(matchingo.newStopLimitOrder(5, SELL, 22, 21, 1));

	expect(stopBook.activate(21).map((o) => o.id)).toStrictEqual([2, 3, 1, 5]);
	expect(stopBook.find(4).id).toBe(4);
});

test("stop book instance: cancel", () => {
	const stopBook = new StopBook(TestSymbol);
	stopBook.append(matchingo.newStopLimitOrder(1, SELL, 10, 9, 1));

	expect(stopBook.cancel(1).id).toBe(1);
	expect(stopBook.cancel(1)).toBe(false);
	expect(stopBook.isEmpty()).toBe(true);
});
