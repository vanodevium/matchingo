![GitHub](https://img.shields.io/github/license/vanodevium/matchingo)

# matchingo

Incredibly fast matching engine for HFT (high-frequency trading) written in JS

### Features

- supports **MARKET**, **LIMIT**, **STOP-LIMIT**, **OCO**, **post-only**, and **iceberg** order types
- supports _time-in-force_ (**GTC**, **FOK**, **IOC**) parameters for **LIMIT** orders
- price-time priority: best price first, then the oldest order; trades happen at the maker price
- supports EventEmitter for outbound signals
- well tested code

### Scope

Matchingo is a **matching engine only**. It does not store accounts or balances,
and it does not check that order IDs are unique over time (this is the task of the library user).
It matches orders, keeps the order book in memory, and sends events.

### Backup and restore

`dump()` returns a compact plain object that captures all resting orders (limit and stop-limit). Save it anywhere — disk, Redis, a database column. `restore(snapshot)` loads it back; the engine resumes from that point with the same sequence counter.

```js
const snap = matchingo.dump();
// snap is a JSON-serializable plain object; store it however you like
const json = JSON.stringify(snap);

// later, in a new process:
const matchingo2 = new Matchingo("BTC/USD", {
	priceScale: 2,
	amountScale: 8,
});
matchingo2.restore(JSON.parse(json));
// matchingo2 is now equivalent to matchingo at the moment dump() was called
```

The dump contains only open orders (internal integers, not decimals). It is as small as the number of resting orders allows. MARKET orders are never resting, so they are never in the dump.

##### Order amount caution

> **It is very important!** Each SYMBOL is a combination of BASE and QUOTE currencies.
> For example, **BTC/USD** where **BTC** is **BASE** currency, **USD** is **QUOTE** currency.

Each order **MUST HAVE** _amount_ parameter but **pay attention**:
if you want to mitigate **double spending**, you have to pass **QUOTE amount** for **MARKET BUY** orders.
If you don't need to freeze money, feel free use **BASE amount**.

> This may seem inconvenient, but it is a precautionary measure for **double spending**: when a user places a
> **MARKET** **BUY** in asynchronous way, you will be able to freeze the correct amount on his balance.

In QUOTE mode the engine buys as much BASE as the budget allows and never spends more than the budget.
It rounds the BASE amount down. If the rest of the budget is too small for one unit of BASE (_dust_),
the engine cancels the rest: the order ID is in `canceled` and `left` is greater than zero.

##### Numbers: scales

The engine does not use floating-point math. It stores prices and amounts as integers.
You **MUST** set the number of digits after the point for the price and for the amount:

```
const matchingo = new Matchingo("BTC/USD", { priceScale: 2, amountScale: 8 });
```

- there are no default scales; the constructor throws an error if a scale is missing
- `priceScale` is also the scale of QUOTE amounts
- scale is an integer from 0 to 15
- you can pass a number or a string (use a string for long values: `"0.00000001"`)
- the engine **rejects** a value with more digits than the scale, a negative value, zero, `NaN`,
  and a value that is not a safe integer after scaling
- `price * amount` (as scaled integers) must be less than 2^53; otherwise the engine throws an error

> [!IMPORTANT]
> **Performance tradeoff: integer precision is capped at 2^53.**
> The engine uses JavaScript numbers as integers for best performance — no BigInt, no decimal library overhead.
> Any single value or `price × amount` product that exceeds 2^53 (≈ 9 quadrillion) is rejected with an error.
> Classic engines use 64-bit integers or arbitrary-precision decimals and have no such cap.
> If your market has very small units (high `amountScale`) or very large nominal values, verify that your
> worst-case `price × amount` stays below the limit.

##### Numbers: tick size and lot size

You can restrict the allowed price and amount increments:

```
const matchingo = new Matchingo("BTC/USD", {
    priceScale: 2,
    amountScale: 8,
    tickSize: "0.01",   // price must be a multiple of 0.01
    lotSize: "0.00000001", // amount must be a multiple of 1 satoshi
});
```

- `tickSize` is the minimum price increment; it must be a positive multiple of `1 / 10^priceScale`
- `lotSize` is the minimum amount increment; it must be a positive multiple of `1 / 10^amountScale`
- both default to `1 / 10^scale` (every value that fits the scale is accepted)
- the engine throws when a price or amount is not a multiple of the respective size
- results, events and `depth()` return normal decimals
- `matchingo.order(id)` returns the internal order; its `price` and `amount` are scaled integers
- `Matchingo.decimalFrom(value, scale)` returns the scaled integer of a value

##### Sequence numbers and timestamps

Each call to `process()` stamps two fields on the order before matching:

- **`seq`** — a monotonically increasing integer, starting at 1 for each `Matchingo` instance; establishes the total arrival order across all order types
- **`timestamp`** — `Date.now()` at the moment `process()` is called (milliseconds since Unix epoch)

Both fields are copied to every entry in `done.order` and `done.trades`.

### Installation (**temporary unavailable, use git clone**)

```
npm i matchingo
```

### Usage

#### Order instance creation

- `matchingo.newMarketOrder(id: string, side: Side, baseAmount: number|string)`
- > only if you understand QUOTE mode, use `matchingo.newMarketBuyQuoteOrder(id: string, quoteAmount: number|string)` or
  > `matchingo.newMarketSellQuoteOrder(id: string, quoteAmount: number|string)`

- `matchingo.newLimitOrder(id: string, side: Side, price: number|string, amount: number|string)`
- `matchingo.newPostOnlyLimitOrder(id: string, side: Side, price: number|string, amount: number|string)`
  — same as a limit order, but **canceled** (not rested) if it would immediately match; it must rest in the book as a maker
- `matchingo.newIcebergOrder(id: string, side: Side, price: number|string, amount: number|string, peakAmount: number|string)`
  — only `peakAmount` is visible in the book at a time; when the visible peak is consumed, the order refills from its hidden reserve and re-queues at the back of the same price level; `peakAmount` must be less than `amount`
- `matchingo.newStopLimitOrder(id: string, side: Side, stop: number|string, price: number|string, amount: number|string)`

Each method throws an error for an invalid value (see "Numbers: scales").

> For OCO orders use `order.setOCO(id: string)`
>
> For time-in-force use `order.setTIF(tif)` with `Matchingo.IOC` or `Matchingo.FOK` (default is GTC)

Constants: `Matchingo.BUY` (1), `Matchingo.SELL` (2), `Matchingo.MARKET`, `Matchingo.LIMIT`,
`Matchingo.STOP_LIMIT`, `Matchingo.IOC`, `Matchingo.FOK`.

#### Order processing

- `matchingo.process(order: Order)`

##### processing result

**process()** returns:

- **done** object for **MARKET** and **LIMIT** orders
- `true` for **STOP-LIMIT** orders (the order is accepted and waits in the stop book)
- `false` if an open order with the same ID exists
- `undefined` if the order is empty

The **done** object contains:

- **order**: exactly processed order
  - **id**: order ID
  - **price**: concrete trade price
  - **isQuote**: _true_ if order's amount was in Quote format
  - **amount**: concrete trade amount
  - **role**: role (`70` is **TAKER**, `80` is **MAKER**)
- **trades**: array of orders; is filled when there was matching; if not empty, first element is exactly processed order.
  - **id**: order ID
  - **price**: concrete trade price
  - **isQuote**: _true_ if order's amount was in Quote format
  - **amount**: concrete trade amount
  - **role**: role (`70` is **TAKER**, `80` is **MAKER**)
- **left**: value of left amount for this processing, can be zero
- **processed**: value of processed amount for this processing, can be zero
- **canceled**: array of order IDs which was cancelled for this processing (**IOC**, **OCO**), can be empty
- **activated**: array of order IDs which was activated for this processing (**STOP** orders), can be empty
- **activations**: array of **done** objects, one for each activated order, in the order of activation; can be empty.
  Each activated order is processed like a new order after the current order is complete, so it has its own `trades`, `canceled` and `activated`

`left` and `processed` describe only the order passed to `process()`.

For instance:

```
{
    "order": {"id": "order2", "price": 10.111, "isQuote": false, "amount": 10, "role": 70},
    "trades": [
        {"id": "order2", "price": 10.111, "isQuote": false, "amount": 10, "role": 70},
        {"id": "order1", "price": 10.111, "isQuote": false, "amount": 10, "role": 80}
    ],
    "processed": 10,
    "left": 0,
    "canceled": [],
    "activated": [],
    "activations": []
}
```

##### OCO orders

An OCO (one-cancels-the-other) order is a pair of linked orders. Call `order.setOCO(linkedId)` on one order to link it to another. When one order in the pair trades (even partially as a maker), the engine immediately cancels the other. The canceled ID appears in `done.canceled`.

OCO pairs typically consist of a resting LIMIT order and a STOP-LIMIT order at different prices, so that only one of them can fill.

##### STOP-LIMIT activation

- the engine checks the stop orders after each trade, with the price of that trade
- a **BUY** stop activates when the trade price is **at or above** the stop price
- a **SELL** stop activates when the trade price is **at or below** the stop price
- no trade, no activation
- an activated order is processed like a new **LIMIT** order after the current order is complete;
  its result is in `activations`, and its unfilled part stays in the order book

#### Order cancellation

- `matchingo.cancel(id: string): bool` - removes an order from the order book or the stop book; `false` if not found

#### Other methods

- `matchingo.order(id)` - returns the open order with this ID, or `false`
- `matchingo.depth()` - returns volume for each price: `{"BTC/USD":{"1":{"10.111":10},"2":{}}}`
  (`1` is **BUY**, `2` is **SELL**)
- `matchingo.bestBid()` - returns `{ price, amount }` for the best (highest) buy price, or `null` if the buy side is empty
- `matchingo.bestAsk()` - returns `{ price, amount }` for the best (lowest) sell price, or `null` if the sell side is empty
- `matchingo.level(side, price)` - returns `{ price, amount }` for the total amount resting at that price level, or `null` if that level does not exist

### Events

Enable events by passing `emitter: true`, then listen by event name:

```js
const matchingo = new Matchingo("BTC/USD", {
	priceScale: 3,
	amountScale: 3,
	emitter: true,
});

matchingo.emitter.on("volume", (event) => {});
matchingo.emitter.on("depth", (event) => {});
matchingo.emitter.on("trade", (event) => {});
```

Each listener receives a single object. All events include `symbol`.
Side and role values are numbers (`1` BUY, `2` SELL, `70` TAKER, `80` MAKER).

#### Event types

- **volume** — fired whenever the resting volume at a price level changes (order added, matched, or canceled)

```json
{ "symbol": "BTC/USD", "side": 1, "price": 10.111, "volume": 10 }
```

Fields: `side` (1 BUY / 2 SELL), `price`, `volume` (total resting amount at that price after the change; `0` means the level is gone).

- **depth** — fired when `depth()` is called

```json
{
	"symbol": "BTC/USD",
	"depth": { "BTC/USD": { "1": { "10.111": 10 }, "2": {} } }
}
```

Fields: `depth` — the full depth snapshot (same object `depth()` returns).

- **trade** — fired once per matched order (taker and each maker get their own event)

```json
{
	"symbol": "BTC/USD",
	"trade": {
		"id": "order1",
		"price": 10.111,
		"isQuote": false,
		"amount": 10,
		"role": 80,
		"seq": 1,
		"timestamp": 1794915538120
	}
}
```

Fields: `trade.id`, `trade.price`, `trade.isQuote`, `trade.amount`, `trade.role` (70 TAKER / 80 MAKER), `trade.seq`, `trade.timestamp`.

- **canceled** — fired for each order canceled during processing (IOC expiry, FOK rejection, OCO cancel, post-only rejection)

```json
{ "symbol": "BTC/USD", "id": "order1" }
```

Fields: `id` — the canceled order ID.

- **activated** — fired when a STOP-LIMIT order is triggered by a trade and enters the order book as a limit order

```json
{ "symbol": "BTC/USD", "id": "stopOrder1" }
```

Fields: `id` — the activated order ID.

### Example

```
import Matchingo from "matchingo";

const matchingo = new Matchingo("BTC/USD", { priceScale: 3, amountScale: 3 });

const order1 = matchingo.newLimitOrder("order1", Matchingo.BUY, 10.111, 10);
const order2 = matchingo.newLimitOrder("order2", Matchingo.SELL, 10.111, 10);

// order book is empty
console.log(matchingo.depth());
// -> {"BTC/USD":{"1":{},"2":{}}}

// because order book is empty, this order is appended only
console.info(matchingo.process(order1));
// -> {"order":{"id":"order1","price":10.111,"isQuote":false,"amount":0,"role":70},"trades":[],"processed":0,"left":0,"canceled":[],"activated":[],"activations":[]}

// order book now contains info about previous order
console.log(matchingo.depth());
// -> {"BTC/USD":{"1":{"10.111":10},"2":{}}}

// this order will be matched with previous
console.info(matchingo.process(order2));
// -> {"order":{"id":"order2","price":10.111,"isQuote":false,"amount":10,"role":70},"trades":[{"id":"order2","price":10.111,"isQuote":false,"amount":10,"role":70},{"id":"order1","price":10.111,"isQuote":false,"amount":10,"role":80}],"processed":10,"left":0,"canceled":[],"activated":[],"activations":[]}

// order book is empty now
console.log(matchingo.depth());
// -> {"BTC/USD":{"1":{},"2":{}}}
```

### License

**matchingo** is open-source software licensed under the [MIT License](LICENSE.md).

### Author

Built by [Vano Devium](https://github.com/vanodevium/)

Made with ❤️ in Ukraine

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/vanodevium)
