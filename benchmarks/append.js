const bench = require("nanobench");
const Order = require("../src/models/order");
const { Symbol, BUY, LIMIT } = require("../src/constants");
const Matcher = require("../src/matcher");

let mss = 0;

function createPriceOrder(type, side, price, amount) {
  return new Order(type, side, Symbol, price, amount, ++mss);
}

bench("Append 10 000 new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  b.start();
  for (let i = 0; i < 10_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});

bench("Append 100 000 new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  b.start();
  for (let i = 0; i < 100_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});

bench("Append 1M new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  b.start();
  for (let i = 0; i < 1_000_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});
