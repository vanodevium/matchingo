const { test, expect } = require("@jest/globals");
const { TestSymbol, SELL, LIMIT, BUY } = require("../src/constants");
const Volume = require("./../src/volume");
const { createTestPriceOrder } = require("../src/new-order");

test("hasEnough SELL", function () {
  const volume = new Volume(TestSymbol);

  const o11 = createTestPriceOrder(11, LIMIT, SELL, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, SELL, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, SELL, 13, 13);

  volume.increase(o11, 11, 11);
  volume.increase(o12, 12, 12);
  volume.increase(o13, 13, 13);

  expect(volume.get(SELL)).toBe(36);
  expect(volume.get(BUY)).toBe(0);

  expect(volume.hasEnough(SELL, 14, 36)).toBeTruthy();
  expect(volume.hasEnough(SELL, 12, 23)).toBeTruthy();
  expect(volume.hasEnough(SELL, 12, 24)).toBeFalsy();
  expect(volume.hasEnough(SELL, 14, 37)).toBeFalsy();
  expect(volume.hasEnough(SELL, 10, 1)).toBeFalsy();
});

test("hasEnough BUY", function () {
  const volume = new Volume(TestSymbol);

  const o11 = createTestPriceOrder(11, LIMIT, BUY, 11, 11);
  const o12 = createTestPriceOrder(12, LIMIT, BUY, 12, 12);
  const o13 = createTestPriceOrder(13, LIMIT, BUY, 13, 13);

  volume.increase(o11, 11, 11);
  volume.increase(o12, 12, 12);
  volume.increase(o13, 13, 13);

  expect(volume.get(BUY)).toBe(36);
  expect(volume.get(SELL)).toBe(0);

  expect(volume.hasEnough(BUY, 11, 36)).toBeTruthy();
  expect(volume.hasEnough(BUY, 12, 25)).toBeTruthy();
  expect(volume.hasEnough(BUY, 12, 26)).toBeFalsy();
  expect(volume.hasEnough(BUY, 14, 37)).toBeFalsy();
  expect(volume.hasEnough(BUY, 14, 1)).toBeFalsy();
});
