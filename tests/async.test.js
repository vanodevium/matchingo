/**
 * AsyncMatchingo: commands run one at a time; queries share a read lock.
 */

import { AsyncMatchingo } from "../src/async-matchingo.js";
import { BUY, SELL } from "../src/constants.js";
import { ErrorCode } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { MemoryWal, readWal } from "../src/wal.js";
import { TestScales, TestSymbol } from "./constants.js";

let wal;
let book;
let m;

beforeEach(() => {
	wal = new MemoryWal();
	book = new Matchingo(TestSymbol, { ...TestScales, wal });
	m = new AsyncMatchingo(book);
});

test("commands and queries resolve with the results", async () => {
	const done = await m.submit(m.newLimitOrder(1, BUY, 10, 5));
	expect(done.stored).toBe(true);
	expect(await m.bestBid()).toEqual({ price: 10, amount: 5 });
	expect((await m.order(1)).id).toBe(1);
	expect(await m.cancel(1)).toBe(true);
});

test("rejections reject the promise and later commands still run", async () => {
	await m.submit(m.newLimitOrder(1, BUY, 10, 5));
	await expect(m.submit(m.newLimitOrder(1, BUY, 10, 5))).rejects.toMatchObject({
		code: ErrorCode.DUPLICATE_ORDER_ID,
	});
	expect((await m.submit(m.newLimitOrder(2, BUY, 10, 5))).stored).toBe(true);
});

test("concurrent commands run in call order, one at a time", async () => {
	const results = await Promise.all([
		m.submit(m.newLimitOrder(1, SELL, 10, 5)),
		m.submit(m.newLimitOrder(2, SELL, 10, 5)),
		m.submit(m.newMarketOrder(3, BUY, 7)),
	]);
	expect(results.map((r) => r.sequence)).toEqual([1, 2, 3]);
	expect(results[2].trades.map((t) => t.id)).toEqual([3, 1, 2]);
	expect(readWal(wal.text).map((r) => r.lsn)).toEqual([1, 2, 3]);
});

test("a command waits for running readers; readers wait for a command", async () => {
	const log = [];
	const slow = (name, ms) => async () => {
		log.push(`${name} start`);
		await new Promise((resolve) => setTimeout(resolve, ms));
		log.push(`${name} end`);
	};
	const lock = (exclusive, name, ms) => m._lock(exclusive, slow(name, ms));

	await Promise.all([
		lock(false, "read1", 20),
		lock(false, "read2", 5),
		lock(true, "write", 5),
		lock(false, "read3", 5),
	]);

	// the readers overlap; the writer starts after both end; read3 after the writer
	expect(log.slice(0, 2)).toEqual(["read1 start", "read2 start"]);
	expect(log.indexOf("write start")).toBeGreaterThan(log.indexOf("read1 end"));
	expect(log.indexOf("write start")).toBeGreaterThan(log.indexOf("read2 end"));
	expect(log.indexOf("read3 start")).toBeGreaterThan(log.indexOf("write end"));
});

test("order factories are available on the wrapper", () => {
	const order = m.newMarketToLimitOrder(1, BUY, 5);
	expect(order.toLimit).toBe(true);
	expect(m.book).toBe(book);
});

test("halt, resume, expire, replace and modify go through the lock", async () => {
	await m.submit(m.newLimitOrder(1, BUY, 10, 5));
	await m.modify(1, 10, 4);
	await m.replace(1, m.newLimitOrder(1, BUY, 11, 4));
	await m.halt();
	expect(book.halted).toBe(true);
	await m.resume();
	expect(await m.expire(1)).toEqual([]);
	expect((await m.dump()).orders).toHaveLength(1);
});
