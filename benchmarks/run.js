import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import { TestScales, TestSymbol } from "../tests/constants.js";

const N = 10 ** 6;
const PRICE = 111;
const AMOUNT = 10;

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

function heapUsed() {
	global.gc?.();
	return process.memoryUsage().heapUsed;
}

function phase(name, fn) {
	const start = process.hrtime.bigint();
	fn();
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	console.log(
		`${name.padEnd(12)} ${ms.toFixed(0).padStart(7)} ms | ${((ms * 1e6) / N)
			.toFixed(0)
			.padStart(6)} ns/op | ${(N / (ms / 1000)).toFixed(0).padStart(9)} ops/s`,
	);
	return ms;
}

const heapStart = heapUsed();
const matchingo = new Matchingo(TestSymbol, false, TestScales);

const buyMs = phase(`${N} BUY`, () => {
	for (let i = 1; i <= N; i++) {
		matchingo.process(matchingo.newLimitOrder(i, BUY, PRICE, AMOUNT));
	}
});
const heapBook = heapUsed();

const sellMs = phase(`${N} SELL`, () => {
	for (let i = 1; i <= N; i++) {
		matchingo.process(matchingo.newLimitOrder(N + i, SELL, PRICE, AMOUNT));
	}
});
const heapEnd = heapUsed();

const depth = matchingo.depth()[TestSymbol];
if (Object.keys(depth[BUY]).length || Object.keys(depth[SELL]).length) {
	throw new Error(`order book is not clear: ${JSON.stringify(depth)}`);
}

const totalMs = buyMs + sellMs;
console.log(
	`total        ${totalMs.toFixed(0).padStart(7)} ms | ${(
		(totalMs * 1e6) /
		(2 * N)
	)
		.toFixed(0)
		.padStart(6)} ns/op`,
);
console.log(
	`heap: start ${mb(heapStart)} MB | full book ${mb(heapBook)} MB (+${mb(
		heapBook - heapStart,
	)}) | end ${mb(heapEnd)} MB | rss ${mb(process.memoryUsage().rss)} MB`,
);
console.log("order book is clear");
