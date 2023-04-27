const bench = require("nanobench");
const assert = require("assert");
const { TestSymbol, SELL, BUY } = require("../src/constants");
const Matchingo = require("../src/matchingo");

[10_000, 100_000, 1_000_000, 3_000_000].map((iterations) => {
  bench(`Match ${iterations} new limit orders`, function (b) {
    const matchingo = new Matchingo(TestSymbol);
    for (let i = 0; i < iterations; i++) {
      matchingo.process(matchingo.newLimitOrder(i + 1, SELL, 111, 10));
    }
    b.start();
    const double = iterations * 2;
    for (let i = iterations; i < double; i++) {
      matchingo.process(matchingo.newLimitOrder(i, BUY, 111, 10));
    }
    b.end();
    assert.ok(!matchingo.orderBook.volume.getRaw()[TestSymbol][BUY]["111"]);
  });
});
