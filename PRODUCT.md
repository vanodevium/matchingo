# Matchingo - Product Specification

This document describes the product `matchingo`.
It uses Simplified Technical English (ASD-STE100): short sentences, active voice, and one word for one meaning.

## 1. Purpose

Matchingo is a matching engine for a trading market.
It is a JavaScript library for Node.js.
It runs in memory. It has one order book for each symbol.
Its goal is high speed.
It is a matching engine only. It does not store accounts or balances. It does not check that an order ID is unique over time.
The user of the library does these tasks.

## 2. Definitions

| Term           | Meaning                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Symbol         | A pair of two currencies, for example `BTC/USD`.                                                 |
| Base currency  | The first currency of the symbol (`BTC`).                                                        |
| Quote currency | The second currency of the symbol (`USD`).                                                       |
| Order book     | The list of open LIMIT orders. It has a BUY side and a SELL side.                                |
| Stop book      | The list of STOP-LIMIT orders that wait for activation.                                          |
| Taker          | The order that you process now.                                                                  |
| Maker          | An order that is already in the order book.                                                      |
| Volume         | The sum of open amounts at one price.                                                            |
| Depth          | The volume at all prices, for both sides.                                                        |
| OCO            | "One cancels the other". Two linked orders. When one order trades, the engine cancels the other. |

## 3. Scope

### 3.1 In scope

- Create orders.
- Match orders.
- Cancel orders.
- Activate STOP-LIMIT orders.
- Cancel OCO orders.
- Report volume and depth.
- Send events.

### 3.2 Out of scope

- Network API.
- Storage on disk.
- User accounts and balances.
- Fees.

The "state backup and restore" function is not available now. It is a future feature.

## 4. Installation and entry point

- Package name: `matchingo`. Version: `0.0.1`. Licence: MIT.
- Module type: ES module.
- Entry point: `index.js`. It exports the `Matchingo` class as the default export.
- The only runtime dependency is `denque`.
- The package is not yet published. Use `git clone`.

## 5. Constants

| Name                   | Value | Use                                                |
| ---------------------- | ----- | -------------------------------------------------- |
| `Matchingo.BUY`        | 1     | Order side.                                        |
| `Matchingo.SELL`       | 2     | Order side.                                        |
| `Matchingo.MARKET`     | 10    | Order type.                                        |
| `Matchingo.LIMIT`      | 20    | Order type.                                        |
| `Matchingo.STOP_LIMIT` | 30    | Order type.                                        |
| `Matchingo.FOK`        | 40    | Time in force.                                     |
| `Matchingo.IOC`        | 50    | Time in force.                                     |
| GTC                    | 60    | Time in force. This is the default for new orders. |
| TAKER                  | 70    | Order role.                                        |
| MAKER                  | 80    | Order role.                                        |

## 6. Order types

### 6.1 MARKET

- A MARKET order has no price.
- It trades at the best prices in the order book until its amount is zero or the book is empty.
- The engine sets its time in force to IOC. The engine cancels the unfilled part.
- The engine never puts a MARKET order in the order book.
- Two MARKET orders can never match.

### 6.2 LIMIT

- A LIMIT order has a price and an amount.
- A BUY order trades with SELL orders at the same price or lower.
- A SELL order trades with BUY orders at the same price or higher.
- The trade price is the price of the maker order.
- The engine puts the unfilled part in the order book, unless the order is canceled.

### 6.3 STOP-LIMIT

- A STOP-LIMIT order has a stop price, a limit price, and an amount.
- The engine puts it in the stop book. It does not trade at once.
- A BUY stop activates when the trade price is at or above the stop price.
  A SELL stop activates when the trade price is at or below the stop price.
- The engine checks the stop orders after each trade, with the price of that trade. A match without a trade does not activate a stop order.
- An activated order changes its type to LIMIT. The engine processes it like a new LIMIT order after the current order is complete.
  The engine puts the unfilled part in the order book.
- The engine lists the order ID in the `activated` field of the result.

## 7. Time in force

Time in force applies to LIMIT orders.

| Value | Name                | Behavior                                                                                                                                  |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GTC   | Good till canceled  | The unfilled part stays in the order book. This is the default.                                                                           |
| IOC   | Immediate or cancel | The engine trades what it can. It cancels the unfilled part.                                                                              |
| FOK   | Fill or kill        | The engine checks the volume first. If the volume is not enough to fill the full amount, the engine cancels the order and makes no trade. |

Set the value with `order.setTIF(tif)`.

## 8. Amount rules

Each order must have an `amount`.

- For MARKET SELL and for all LIMIT orders, the amount is in base currency.
- For MARKET BUY, you can use the quote currency. This is "quote mode".
- Use quote mode to prevent double spending.
  The caller can then freeze the exact quote amount on the balance of the user.
- In quote mode, the engine buys `floor(quote * 10^amountScale / price)` base units from each maker order.
  It charges `ceil(base * price / 10^amountScale)` quote units.
  It never spends more than the amount of the order.
- If the rest of the amount cannot buy one base unit, this rest is dust. The engine cancels the dust.
- Quote mode is only valid for MARKET orders.
  The engine ignores `setQuoteMode()` for other order types.

### 8.1 Numbers and scales

- The engine uses integers inside. It does not use floating-point math for prices and amounts.
- The caller sets `priceScale` and `amountScale` (digits after the point, from 0 to 15). There is no default.
  `priceScale` is also the scale of quote amounts.
- The caller can pass a number or a string.
- The engine rejects a value that has more digits than the scale, a negative value, zero, `NaN`, and a value above 2^53 after scaling.
- The engine rejects an order if `price * amount` (as integers) is above 2^53.
- The engine converts the integers back to decimals in `Done`, events, and `depth()`.

## 9. Public API

### 9.1 Constructor

`new Matchingo(symbol, emit, { priceScale, amountScale })`

| Argument      | Type    | Description                                                     |
| ------------- | ------- | --------------------------------------------------------------- |
| `symbol`      | string  | Required. The constructor throws an error if it is empty.       |
| `emit`        | boolean | Optional. If `true`, the engine sends events. Default: `false`. |
| `priceScale`  | integer | Required. Digits after the point for prices and quote amounts.  |
| `amountScale` | integer | Required. Digits after the point for base amounts.              |

`Matchingo.decimalFrom(value, scale)` returns the scaled integer of a number or string.

### 9.2 Order factories

| Method                                             | Result                         |
| -------------------------------------------------- | ------------------------------ |
| `newMarketOrder(id, side, baseAmount)`             | MARKET order, base amount.     |
| `newMarketBuyQuoteOrder(id, quoteAmount)`          | MARKET BUY order, quote mode.  |
| `newMarketSellQuoteOrder(id, quoteAmount)`         | MARKET SELL order, quote mode. |
| `newLimitOrder(id, side, price, amount)`           | LIMIT order.                   |
| `newStopLimitOrder(id, side, stop, price, amount)` | STOP-LIMIT order.              |

The `id` is a string or a number. It must be unique for the symbol.

### 9.3 Order methods

- `order.setTIF(tif)` sets the time in force.
- `order.setOCO(id)` links the order to another order ID.

### 9.4 Engine methods

| Method           | Description                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `process(order)` | Match the order. See section 10.                                                                                 |
| `cancel(id)`     | Remove an order from the order book or the stop book. Return `true` if the order existed. Return `false` if not. |
| `order(id)`      | Return the open order with this ID, or nothing.                                                                  |
| `depth()`        | Return the volume at each price. See section 11.                                                                 |
| `add(order)`     | Put an order in the order book or stop book without matching. Used internally.                                   |

### 9.5 Errors

The engine throws an error in these cases:

- The symbol of the order is not the symbol of the engine.
- A MARKET order goes into the order book.
- Two MARKET orders try to match.
- A trade makes the open amount of an order less than zero.
- A price or amount is not valid (see section 8.1).
- A scale is missing or not valid.

## 10. Processing rules

`process(order)` does these steps in this sequence:

1. If `order` is empty, return nothing.
2. If an open order has the same ID, return `false`. The engine does nothing else.
3. Clear the data of the previous call.
4. If another order already canceled this order through OCO, cancel it and return the result.
5. If the order is STOP-LIMIT, put it in the stop book and return `true`.
6. If the order is MARKET, set the time in force to IOC.
7. If the order is LIMIT with FOK and the volume is not enough, cancel it and return the result.
8. Match the order against the best prices of the opposite side, from best to worst.
9. After each trade, activate the STOP-LIMIT orders that the trade price crosses.
10. For IOC orders, cancel the unfilled part.
11. Put the unfilled part of a LIMIT order in the order book.
12. Return the result. For each activated STOP-LIMIT order, in the order of activation, do steps 3 to 12 again. Put the result in `activations`.

Within one price level, the engine matches orders by time. The oldest order trades first.
The engine matches price levels by price. The best price trades first.

The return value of `process()` is one of these:

| Value         | Case                                    |
| ------------- | --------------------------------------- |
| `Done` object | MARKET and LIMIT orders.                |
| `true`        | The engine accepted a STOP-LIMIT order. |
| `false`       | The ID is not unique.                   |
| nothing       | The order is empty.                     |

### 10.1 OCO rules

- Link two orders. Call `setOCO(otherId)` on each order.
- When one order trades, the engine cancels the other order.
- The other order can be in the order book or in the stop book.
- The engine also cancels a linked maker order that it finds during matching.

### 10.2 Done object

| Field         | Description                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `order`       | The order that the caller processed. It has `id`, `price`, `isQuote`, `amount`, and `role`.                                                     |
| `trades`      | The list of trades. If it has items, the first item is the processed order. Each item has `id`, `price`, `isQuote`, `amount`, and `role`.       |
| `processed`   | The amount that the engine traded in this call. It can be zero.                                                                                 |
| `left`        | The amount that the engine did not trade in this call. It can be zero.                                                                          |
| `canceled`    | The IDs of orders that the engine canceled in this call. It can be empty.                                                                       |
| `activated`   | The IDs of STOP-LIMIT orders that the engine activated in this call. It can be empty.                                                           |
| `activations` | The `Done` objects of the activated STOP-LIMIT orders, in the order of activation. Each one has the same fields as this table. It can be empty. |

In quote mode, `processed` and the trade amounts are in quote currency.

## 11. Depth and volume

`depth()` returns this structure:

```json
{ "BTC/USD": { "1": { "10.111": 10 }, "2": {} } }
```

- The key of each side is the side constant (`1` BUY, `2` SELL). The key of each price level is the price. The value is the total open amount at this price.
- The engine updates the volume when it adds, trades, or cancels a LIMIT order.
- The engine does not count MARKET orders in the volume.
- The engine does not count STOP-LIMIT orders in the volume.

## 12. Events

If `emit` is `true`, the engine sends events.
Listen to them with `matchingo.emitter.on(symbol, (header, data) => {})`.
The emitter is a Node.js `EventEmitter`. The event name is the symbol.

| Event type  | When                           | Data                                   |
| ----------- | ------------------------------ | -------------------------------------- |
| `volume`    | The volume at a price changes. | `side`, `price`, `volume`              |
| `depth`     | Someone calls `depth()`.       | `depth`                                |
| `trade`     | A trade happens.               | `trade` (see `trades` in section 10.2) |
| `canceled`  | The engine cancels an order.   | `id`                                   |
| `activated` | A STOP-LIMIT order activates.  | `id`                                   |

The `header` argument has `symbol` and `type`.

## 13. Non-functional requirements

- **Speed.** Matching must be fast.
  The engine uses a skip list and a double-ended queue (`denque`) for the order book.
  These structures give fast insert, remove, and best-price access.
- **Correctness.** Tests must cover all order types, time in force values, OCO, stop activation, volume, and events.
  A parity test compares the results with a Go implementation.
- **Single thread.** The engine has no locks. One caller at a time can use one engine instance.
- **Memory.** All state is in memory. A restart removes all state.

## 14. Project layout

| Path                                                                                | Content                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `index.js`                                                                          | Package entry point.                        |
| `src/matchingo.js`                                                                  | Engine class.                               |
| `src/order-book.js`, `src/stop-book.js`                                             | Order book and stop book.                   |
| `src/ordered-set-orders-queue.js`, `src/skip-list.js`, `src/ordered-set-numbers.js` | Sorted data structures.                     |
| `src/price-comparator.js`                                                           | Trade price rules.                          |
| `src/volume.js`                                                                     | Volume and FOK check.                       |
| `src/emmiter.js`                                                                    | Event emitter.                              |
| `src/models/`                                                                       | `Order`, `StopLimitOrder`, `Trade`, `Done`. |
| `tests/`                                                                            | Vitest tests.                               |
| `benchmarks/run.js`                                                                 | Speed tests (`mitata`).                     |
| `examples/`                                                                         | Usage examples.                             |

## 15. Tools

- Test: `npm test` (Vitest).
- Format: `npm run fix` (Prettier and Biome).
