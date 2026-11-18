import Matchingo from "../index.js";

const matchingo = new Matchingo("BTC/USD", {
	priceScale: 3,
	amountScale: 3,
});

const order1 = matchingo.newLimitOrder("order1", Matchingo.BUY, 10.111, 10);
const order2 = matchingo.newLimitOrder("order2", Matchingo.SELL, 10.111, 10);

// order book is empty
console.log(matchingo.depth());
// -> {"BTC/USD":{"1":{},"2":{}}}

// because order book is empty, this order only rests
console.info(matchingo.submit(order1));
// -> trades: [], processed: 0, left: 10, stored: true

// order book now contains info about previous order
console.log(matchingo.depth());
// -> {"BTC/USD":{"1":{"10.111":10},"2":{}}}

// this order will be matched with previous
console.info(matchingo.submit(order2));
// -> trades: [taker summary (amount 10), maker order1 (amount 10)], processed: 10, left: 0, stored: false

// order book is empty now
console.log(matchingo.depth());
// -> {"BTC/USD":{"1":{},"2":{}}}
