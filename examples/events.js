import Matchingo from "../index.js";

const matchingo = new Matchingo("BTC/USD", true, {
	priceScale: 3,
	amountScale: 3,
});

matchingo.emitter.on("BTC/USD", (event) => {
	console.log(JSON.stringify(event));
});

const order1 = matchingo.newLimitOrder("order1", Matchingo.BUY, 10.111, 10);
const order2 = matchingo.newLimitOrder("order2", Matchingo.SELL, 10.111, 10);

matchingo.depth();
matchingo.process(order1);
matchingo.depth();
matchingo.process(order2);
