/**
 * Write-ahead log, recovery by snapshot + replay.
 */

import { BUY, SELL } from "../src/constants.js";
import { ErrorCode, MatchingoError } from "../src/errors.js";
import Matchingo from "../src/matchingo.js";
import { MemoryWal, readWal } from "../src/wal.js";
import { TestScales, TestSymbol } from "./constants.js";

let wal;
let now;

const options = (extra = {}) => ({
	...TestScales,
	circuitBreaker: 50,
	instrument: { tickSize: 1 },
	clock: () => now++,
	...extra,
});

beforeEach(() => {
	wal = new MemoryWal();
	now = 1000;
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
// Logging
// ---------------------------------------------------------------------------

describe("logging", () => {
	test("every state-changing command is logged with lsn and time", () => {
		const m = new Matchingo(TestSymbol, options({ wal }));
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		m.replace(1, m.newLimitOrder(2, BUY, 10, 5));
		m.modify(2, 10, 3);
		m.modify(2, 11, 3);
		m.submit(m.newStopLimitOrder(3, BUY, 20, 21, 1));
		m.modifyStop(3, 20, 22, 1);
		m.cancel(3);
		m.expire(5000);
		m.halt();
		m.resume();

		const records = readWal(wal.text);
		expect(records.map((r) => r.op)).toEqual([
			"submit",
			"replace",
			"modify",
			"modify",
			"submit",
			"modifyStop",
			"cancel",
			"expire",
			"halt",
			"resume",
		]);
		expect(records.map((r) => r.lsn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(records.every((r) => typeof r.time === "number")).toBe(true);
		expect(wal.text.split("\n")).toHaveLength(11); // one record per line
	});

	test("commands that change nothing are not logged", () => {
		const m = new Matchingo(TestSymbol, options({ wal }));
		m.cancel(99); // unknown
		m.resume(); // not halted
		m.halt();
		m.halt(); // already halted
		expect(readWal(wal.text).map((r) => r.op)).toEqual(["halt"]);
	});

	test("the record is written before the command is applied", () => {
		const seen = [];
		const m = new Matchingo(TestSymbol, options());
		m.attachWal({
			write() {
				seen.push(m.order(1));
			},
		});
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		expect(seen).toEqual([null]);
	});

	test("sync() of the sink is called after every record", () => {
		let writes = 0;
		let syncs = 0;
		const m = new Matchingo(TestSymbol, options());
		m.attachWal({
			write() {
				writes++;
			},
			sync() {
				syncs++;
			},
		});
		m.submit(m.newLimitOrder(1, BUY, 10, 5));
		m.submit(m.newLimitOrder(2, BUY, 10, 5));
		expect([writes, syncs]).toEqual([2, 2]);
	});

	test("the clock is frozen to the logged time while the command runs", () => {
		const m = new Matchingo(TestSymbol, options({ wal }));
		const done = m.submit(m.newLimitOrder(1, BUY, 10, 5).setTTL(100));
		const [record] = readWal(wal.text);
		expect(done.order.timestamp).toBe(record.time);
		expect(done.order.expiry).toBe(record.time + 100);
	});
});

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

describe("log failure", () => {
	const failing = () => {
		const sink = { fail: false, lines: [] };
		sink.write = (line) => {
			if (sink.fail) {
				throw new Error("disk full");
			}
			sink.lines.push(line);
		};
		return sink;
	};

	test("the command is not applied and the error is latched", () => {
		const sink = failing();
		const m = new Matchingo(TestSymbol, options({ wal: sink }));
		m.submit(m.newLimitOrder(1, BUY, 10, 5));

		sink.fail = true;
		expect(code(() => m.submit(m.newLimitOrder(2, BUY, 10, 5)))).toBe(
			ErrorCode.WAL_FAILURE,
		);
		expect(m.order(2)).toBeNull();

		sink.fail = false; // the disk recovers, but the error stays latched
		expect(code(() => m.submit(m.newLimitOrder(3, BUY, 10, 5)))).toBe(
			ErrorCode.WAL_FAILURE,
		);
		expect(code(() => m.cancel(1))).toBe(ErrorCode.WAL_FAILURE);
		expect(code(() => m.halt())).toBe(ErrorCode.WAL_FAILURE);
		expect(m.order(1)).toBeTruthy();
	});

	test("reattaching the log clears the error", () => {
		const sink = failing();
		const m = new Matchingo(TestSymbol, options({ wal: sink }));
		sink.fail = true;
		expect(code(() => m.submit(m.newLimitOrder(1, BUY, 10, 5)))).toBe(
			ErrorCode.WAL_FAILURE,
		);

		sink.fail = false;
		m.attachWal(sink);
		expect(m.submit(m.newLimitOrder(1, BUY, 10, 5)).stored).toBe(true);
		expect(sink.lines).toHaveLength(1);
	});

	test("a failing sync also refuses the command", () => {
		const m = new Matchingo(TestSymbol, options());
		m.attachWal({
			write() {},
			sync() {
				throw new Error("fsync");
			},
		});
		expect(code(() => m.submit(m.newLimitOrder(1, BUY, 10, 5)))).toBe(
			ErrorCode.WAL_FAILURE,
		);
		expect(m.order(1)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe("readWal", () => {
	const record = (lsn) => `${JSON.stringify({ lsn, time: 1, op: "halt" })}\n`;

	test("a torn last line is ignored", () => {
		const text = `${record(1)}${record(2)}{"lsn":3,"time":1,"op":"ha`;
		expect(readWal(text).map((r) => r.lsn)).toEqual([1, 2]);
	});

	test("a corrupt line in the middle is an error", () => {
		const text = `${record(1)}{broken\n${record(3)}`;
		expect(code(() => readWal(text))).toBe(ErrorCode.INVALID_WAL_RECORD);
	});

	test("a record of the wrong shape is an error", () => {
		const text = `${JSON.stringify({ lsn: 1, time: 1, op: "nope" })}\n`;
		expect(code(() => readWal(text))).toBe(ErrorCode.INVALID_WAL_RECORD);
		expect(code(() => readWal("123\n"))).toBe(ErrorCode.INVALID_WAL_RECORD);
	});

	test("an empty log has no records", () => {
		expect(readWal("")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

describe("recovery", () => {
	/**
	 * A scenario with every kind of command, rejected ones included.
	 */
	const scenario = (m) => {
		const step = (fn) => {
			try {
				fn();
			} catch (error) {
				if (!(error instanceof MatchingoError)) {
					throw error;
				}
			}
		};
		step(() => m.submit(m.newLimitOrder(1, SELL, 100, 10)));
		step(() => m.submit(m.newLimitOrder(2, SELL, 101, 10).setTTL(50)));
		step(() => m.submit(m.newIcebergOrder(3, SELL, 102, 12, 4)));
		step(() => m.submit(m.newLimitOrder(4, BUY, 95, 10)));
		step(() => m.submit(m.newLimitOrder(5, BUY, 94, 10).setExpiry(1040)));
		step(() => m.submit(m.newStopLimitOrder(6, BUY, 101, 103, 3)));
		step(() => m.submit(m.newStopMarketOrder(7, SELL, 95, 2)));
		step(() => m.submit(m.newTrailingStopOrder(8, SELL, 80, 2, { offset: 5 })));
		step(() => m.submit(m.newLimitOrder(4, BUY, 1, 1))); // duplicate: rejected
		step(() => m.submit(m.newLimitOrder(9, BUY, 99, 1))); // not a multiple... fine
		step(() => m.submit(m.newMarketOrder(10, BUY, 12)));
		step(() => m.modify(4, 96, 8));
		step(() => m.modify(4, 96, 5));
		step(() => m.modifyStop(7, 96, 0, 3));
		step(() => m.replace(9, m.newLimitOrder(11, BUY, 97, 2)));
		step(() => m.submit(m.newMarketToLimitOrder(12, SELL, 30)));
		step(() => m.submit(m.newLimitOrder(13, SELL, 105, 3).setSTP("a", 4)));
		step(() => m.submit(m.newLimitOrder(14, BUY, 105, 2).setSTP("a", 4)));
		step(() => m.expire(1060));
		step(() => m.cancel(11));
		step(() => m.halt());
		step(() => m.submit(m.newLimitOrder(15, BUY, 1, 1))); // halted: rejected
		step(() => m.resume());
		step(() => m.submit(m.newMarketBuyQuoteOrder(16, 500)));
	};

	test("snapshot + replay reproduces the live state", () => {
		const live = new Matchingo(TestSymbol, options({ wal }));
		scenario(live);

		const recovered = new Matchingo(TestSymbol, options());
		recovered.replay(readWal(wal.text));

		expect(recovered.dump()).toEqual(live.dump());
		expect(recovered.depth()).toEqual(live.depth());
	});

	test("replay after a snapshot taken in the middle", () => {
		const m = new Matchingo(TestSymbol, options({ wal }));
		const commands = [
			() => m.submit(m.newLimitOrder(1, SELL, 100, 10)),
			() => m.submit(m.newLimitOrder(2, BUY, 95, 10)),
			() => m.submit(m.newStopLimitOrder(3, BUY, 101, 103, 3)),
			() => m.submit(m.newMarketOrder(4, BUY, 4)),
			() => m.modify(2, 96, 10),
			() => m.cancel(2),
			() => m.submit(m.newLimitOrder(5, SELL, 101, 5)),
			() => m.submit(m.newMarketOrder(6, BUY, 3)),
			() => m.submit(m.newLimitOrder(7, BUY, 90, 3)),
			() => m.submit(m.newLimitOrder(8, SELL, 120, 3)),
		];
		for (const run of commands.slice(0, 5)) {
			run();
		}
		const snapshot = JSON.parse(JSON.stringify(m.dump()));
		for (const run of commands.slice(5)) {
			run();
		}
		expect(snapshot.lsn).toBe(5);

		const recovered = new Matchingo(TestSymbol, options());
		recovered.restore(snapshot);
		recovered.replay(readWal(wal.text));
		expect(recovered.dump()).toEqual(m.dump());
	});

	test("replay does not write to the log", () => {
		const live = new Matchingo(TestSymbol, options({ wal }));
		scenario(live);
		const before = wal.text;

		const target = new MemoryWal();
		const recovered = new Matchingo(TestSymbol, options({ wal: target }));
		recovered.replay(readWal(before));
		expect(target.text).toBe("");
		expect(wal.text).toBe(before);
	});

	test("after recovery the book continues the log", () => {
		const live = new Matchingo(TestSymbol, options({ wal }));
		scenario(live);

		const target = new MemoryWal();
		const recovered = new Matchingo(TestSymbol, options());
		recovered.replay(readWal(wal.text));
		recovered.attachWal(target);
		recovered.submit(recovered.newLimitOrder(100, BUY, 50, 1));
		expect(readWal(target.text)[0].lsn).toBe(readWal(wal.text).length + 1);
	});

	test("a gap in the log is an error", () => {
		const live = new Matchingo(TestSymbol, options({ wal }));
		live.halt();
		live.resume();
		live.halt();
		const records = readWal(wal.text);
		const recovered = new Matchingo(TestSymbol, options());
		expect(code(() => recovered.replay([records[0], records[2]]))).toBe(
			ErrorCode.WAL_GAP,
		);
		// the log does not start right after the snapshot
		const other = new Matchingo(TestSymbol, options());
		expect(code(() => other.replay([records[1], records[2]]))).toBe(
			ErrorCode.WAL_GAP,
		);
	});

	test("records up to the snapshot position are skipped", () => {
		const live = new Matchingo(TestSymbol, options({ wal }));
		live.submit(live.newLimitOrder(1, BUY, 10, 5));
		const snapshot = live.dump();
		live.submit(live.newLimitOrder(2, BUY, 10, 5));

		const recovered = new Matchingo(TestSymbol, options());
		recovered.restore(snapshot);
		recovered.replay(readWal(wal.text));
		expect(recovered.dump()).toEqual(live.dump());
	});

	test("an invalid record is an error", () => {
		const recovered = new Matchingo(TestSymbol, options());
		expect(code(() => recovered.replay([{ lsn: 1 }]))).toBe(
			ErrorCode.INVALID_WAL_RECORD,
		);
	});

	test("ids and sequence numbers are reproduced", () => {
		const live = new Matchingo(TestSymbol, options({ wal }));
		scenario(live);
		const recovered = new Matchingo(TestSymbol, options());
		recovered.replay(readWal(wal.text));
		const next = (m) => m.submit(m.newLimitOrder(500, SELL, 10, 1));
		expect(next(recovered).sequence).toBe(next(live).sequence);
	});
});
