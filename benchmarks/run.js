import DenQueue from "denque";
import { bench, run } from "mitata";
import { BUY, SELL } from "../src/constants.js";
import Matchingo from "../src/matchingo.js";
import OrderedSetOrdersQueue from "../src/ordered-set-orders-queue.js";
import { TestSymbol } from "../tests/constants.js";

// BenchmarkAppendLimitOrders: append-only, no matching
bench("BenchmarkAppendLimitOrders", function* () {
	const matchingo = new Matchingo(TestSymbol);
	const orders = [];
	for (let i = 0; i < 10000; i++) {
		orders.push(matchingo.newLimitOrder(i + 1, BUY, 111, 10));
	}
	yield () => {
		orders.forEach((order) => {
			matchingo.process(order);
		});
	};
});

// BenchmarkLimitOrders: process limit orders through matching engine
bench("BenchmarkLimitOrders", function* () {
	const matchingo = new Matchingo(TestSymbol);
	const n = 5000;
	for (let i = 0; i < n; i++) {
		matchingo.process(matchingo.newLimitOrder(i + 1, SELL, 111, 10));
	}
	yield () => {
		for (let i = 0; i < n; i++) {
			matchingo.process(matchingo.newLimitOrder(n + i + 1, BUY, 111, 10));
		}
	};
});

// BenchmarkOrderSide: append limit orders to one side (bid)
bench("BenchmarkOrderSide", function* () {
	const orderSide = new OrderedSetOrdersQueue("desc", "price");
	const matchingo = new Matchingo(TestSymbol);
	yield () => {
		for (let i = 1; i <= 10000; i++) {
			const order = matchingo.newLimitOrder(i, BUY, 16, 150);
			orderSide.append(order);
		}
	};
});

// BenchmarkOrderQueue: append orders to a single-price queue
bench("BenchmarkOrderQueue", function* () {
	const matchingo = new Matchingo(TestSymbol);
	const queue = new DenQueue();
	yield () => {
		for (let i = 1; i <= 10000; i++) {
			const order = matchingo.newLimitOrder(i, BUY, 16, i);
			queue.push(order);
		}
	};
});

// BenchmarkQueueSliceReview: create a queue, append 1000 orders, and verify
bench("BenchmarkQueueSliceReview", function* () {
	const matchingo = new Matchingo(TestSymbol);
	const order = matchingo.newLimitOrder("benchmark", BUY, 10, 1);
	yield () => {
		const queue = new DenQueue();
		for (let j = 0; j < 1000; j++) {
			queue.push(order);
		}
		if (queue.length !== 1000) {
			throw new Error("unexpected length");
		}
	};
});

run();
