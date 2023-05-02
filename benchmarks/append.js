const bench = require("nanobench");
const assert = require("assert");
const { TestSymbol, BUY } = require("../src/constants");
const Matchingo = require("../src/matchingo");

[10_000, 100_000, 1_000_000, 3_000_000].map((iterations) => {
  bench(`Append ${iterations} new limit orders from array`, function (b) {
    const matchingo = new Matchingo(TestSymbol);
    _append(b, 0, iterations, matchingo);
    assert.ok(
      matchingo.orderBook.volume.getRaw()[TestSymbol][BUY]["111"] ===
        iterations * 10,
    );
  });
});

function _append(b, start = 0, iterations, matchingo) {
  const orders = [];
  for (let i = 0; i < iterations; i++) {
    orders.push(matchingo.newLimitOrder(++start, BUY, 111, 10));
  }
  b.start();
  orders.map((order) => {
    matchingo.process(order);
  });
  b.end();
}
