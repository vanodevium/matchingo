import { ErrorCode, MatchingoError } from "./errors.js";

const OPS = new Set([
	"submit",
	"replace",
	"cancel",
	"modify",
	"modifyStop",
	"expire",
	"halt",
	"resume",
]);

/**
 * A write-ahead log sink that keeps the lines in memory.
 * A sink is any object with `write(line: string)`; it may also have `sync()`,
 * which the engine calls after every record to flush it to durable storage.
 */
export class MemoryWal {
	constructor() {
		this.text = "";
	}

	write(line) {
		this.text += line;
	}
}

/**
 * Parse a log: one JSON record per line. A torn last line (a crash in the
 * middle of a write; the command was never applied) is ignored.
 * @param {string} text
 * @returns {object[]}
 */
export function readWal(text) {
	const lines = text.split("\n");
	const records = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === "") {
			continue;
		}
		let record;
		try {
			record = JSON.parse(lines[i]);
		} catch {
			if (i === lines.length - 1) {
				break;
			}
			throw new MatchingoError(
				ErrorCode.INVALID_WAL_RECORD,
				`invalid WAL record on line ${i + 1}`,
			);
		}
		records.push(checkRecord(record, i + 1));
	}
	return records;
}

export function checkRecord(record, line) {
	if (
		record === null ||
		typeof record !== "object" ||
		!Number.isInteger(record.lsn) ||
		typeof record.time !== "number" ||
		!OPS.has(record.op)
	) {
		throw new MatchingoError(
			ErrorCode.INVALID_WAL_RECORD,
			`invalid WAL record${line ? ` on line ${line}` : ""}`,
		);
	}
	return record;
}
