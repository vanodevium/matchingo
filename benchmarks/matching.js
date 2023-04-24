const bench = require("nanobench");
const Order = require("../src/models/order");
const { Symbol, BUY, LIMIT, SELL } = require("../src/constants");
const Matcher = require("../src/matcher");

let mss = 0;

function createPriceOrder(type, side, price, amount) {
  return new Order(type, side, Symbol, price, amount, ++mss);
}

bench("Match 10 000 new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  for (let i = 0; i < 10_000; i++) {
    matcher.match(createPriceOrder(LIMIT, SELL, 111, 10));
  }
  b.start();
  for (let i = 0; i < 10_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});

bench("Match 10 000 new Limits different prices", function (b) {
  const matcher = new Matcher(Symbol);
  for (let i = 1; i <= 10_000; i++) {
    matcher.match(createPriceOrder(LIMIT, SELL, i, 10));
  }
  b.start();
  for (let i = 1; i <= 10_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, i, 10));
  }
  b.end();
});

bench("Match 100 000 new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  for (let i = 0; i < 100_000; i++) {
    matcher.match(createPriceOrder(LIMIT, SELL, 111, 10));
  }
  b.start();
  for (let i = 0; i < 100_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});

bench("Match 1M new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  for (let i = 0; i < 1_000_000; i++) {
    matcher.match(createPriceOrder(LIMIT, SELL, 111, 10));
  }
  b.start();
  for (let i = 0; i < 1_000_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});

bench("Match 2M new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  for (let i = 0; i < 2_000_000; i++) {
    matcher.match(createPriceOrder(LIMIT, SELL, 111, 10));
  }
  b.start();
  for (let i = 0; i < 2_000_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});

bench("Match 3M new Limits", function (b) {
  const matcher = new Matcher(Symbol);
  for (let i = 0; i < 3_000_000; i++) {
    matcher.match(createPriceOrder(LIMIT, SELL, 111, 10));
  }
  b.start();
  for (let i = 0; i < 3_000_000; i++) {
    matcher.match(createPriceOrder(LIMIT, BUY, 111, 10));
  }
  b.end();
});
