import Matchingo from "./../index.js";
import Done from "./../src/models/done.js";
import Trade from "./../src/models/trade.js";
import { TestScales, TestSymbol } from "./constants.js";

const matchingo = new Matchingo(TestSymbol, false, TestScales);

test("done structure limit no trades", () => {
	const main = matchingo.newLimitOrder("main", Matchingo.BUY, 111, 111);
	const trade = new Trade(main);

	const done = new Done(
		trade,
		[matchingo.newLimitOrder("canceled", Matchingo.SELL, 111, 10)],
		[matchingo.newLimitOrder("activated", Matchingo.SELL, 111, 10)],
	);

	expect(done).toEqual({
		order: {
			id: "main",
			price: 111,
			isQuote: false,
			amount: 0,
			role: 70,
		},
		trades: [],
		processed: 0,
		left: 0,
		canceled: ["canceled"],
		activated: ["activated"],
		activations: [],
	});
});

test("done structure limit", () => {
	const main = matchingo.newLimitOrder("main", Matchingo.BUY, 111, 111);
	const trade = new Trade(main);

	const orders = [];

	for (let i = 10; i < 15; i++) {
		const o = matchingo.newLimitOrder(`order${i}`, Matchingo.SELL, 111, i);
		o.increase(10, 111, false);
		o.tradePrice = o.price;
		orders.push(o);
	}

	trade.setOrders(orders);

	const done = new Done(
		trade,
		[matchingo.newLimitOrder("canceled", Matchingo.SELL, 111, 10)],
		[matchingo.newLimitOrder("activated", Matchingo.SELL, 111, 10)],
	);

	expect(done).toEqual({
		order: {
			id: "main",
			price: 111,
			isQuote: false,
			amount: 50,
			role: 70,
		},
		trades: [
			{
				id: "main",
				price: 111,
				isQuote: false,
				amount: 50,
				role: 70,
			},
			{
				id: "order10",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order11",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order12",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order13",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order14",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
		],
		processed: 50,
		left: 61,
		canceled: ["canceled"],
		activated: ["activated"],
		activations: [],
	});
});

test("done structure market", () => {
	const main = matchingo.newMarketBuyQuoteOrder("main", 5555);
	const trade = new Trade(main);

	const orders = [];

	for (let i = 10; i < 15; i++) {
		const o = matchingo.newLimitOrder(`order${i}`, Matchingo.SELL, 111, i);
		o.increase(10, 111, false);
		o.tradePrice = o.price;
		orders.push(o);
	}

	trade.setOrders(orders);

	const done = new Done(
		trade,
		[matchingo.newLimitOrder("canceled", Matchingo.SELL, 111, 10)],
		[matchingo.newLimitOrder("activated", Matchingo.SELL, 111, 10)],
	);

	expect(done).toEqual({
		order: {
			id: "main",
			price: 0,
			isQuote: true,
			amount: 5550,
			role: 70,
		},
		trades: [
			{
				id: "main",
				price: 0,
				isQuote: true,
				amount: 5550,
				role: 70,
			},
			{
				id: "order10",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order11",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order12",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order13",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
			{
				id: "order14",
				price: 111,
				isQuote: false,
				amount: 10,
				role: 70,
			},
		],
		processed: 5550,
		left: 5,
		canceled: ["canceled"],
		activated: ["activated"],
		activations: [],
	});
});
