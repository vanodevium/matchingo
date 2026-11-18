import Matchingo from "../index.js";

const matchingo = new Matchingo("BTC/USD", {
	priceScale: 3,
	amountScale: 3,
	emitter: true,
});

matchingo.emitter.on("volume", (event) => {
	console.log("volume", JSON.stringify(event));
});

matchingo.emitter.on("depth", (event) => {
	console.log("depth", JSON.stringify(event));
});

matchingo.emitter.on("trade", (event) => {
	console.log("trade", JSON.stringify(event));
});

const order1 = matchingo.newLimitOrder("order1", Matchingo.BUY, 10.111, 10);
const order2 = matchingo.newLimitOrder("order2", Matchingo.SELL, 10.111, 10);

matchingo.depth();
matchingo.submit(order1);
matchingo.depth();
matchingo.submit(order2);
