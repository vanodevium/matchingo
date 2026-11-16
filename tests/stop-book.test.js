import { BUY } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import StopBook from "../src/stop-book.js";
import { TestSymbol } from "./constants.js";

let matchingo;

beforeEach(() => {
	matchingo = new Matchingo(TestSymbol);
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
