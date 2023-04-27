const Matchingo = require("../index");

const matchingo = new Matchingo("BTC/USD");

const order1 = matchingo.newLimitOrder("order1", Matchingo.BUY, 10.111, 10);
const order2 = matchingo.newLimitOrder("order2", Matchingo.SELL, 10.111, 10);

// order book is empty
console.log(matchingo.depth());
// -> {"BTC/USD":{"BUY":{},"SELL":{}}}

// because order book is empty, this order is appended only
console.info(matchingo.process(order1));
// -> {"order":{"id":"order1","price":10.111,"isQuote":false,"amount":0,"role":"TAKER"},"trades":[],"processed":0,"left":0,"canceled":[],"activated":[]}

// order book now contains info about previous order
console.log(matchingo.depth());
// -> {"BTC/USD":{"BUY":{"10.111":10},"SELL":{}}}

// this order will be matched with previous
console.info(matchingo.process(order2));
// -> {"order":{"id":"order2","price":10.111,"isQuote":false,"amount":10,"role":"TAKER"},"trades":[{"id":"order2","price":10.111,"isQuote":false,"amount":10,"role":"TAKER"},{"id":"order1","price":10.111,"isQuote":false,"amount":10,"role":"MAKER"}],"processed":10,"left":0,"canceled":[],"activated":[]}

// order book is empty now
console.log(matchingo.depth());
// -> {"BTC/USD":{"BUY":{},"SELL":{}}}
