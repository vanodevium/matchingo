![GitHub](https://img.shields.io/github/license/vanodevium/matchingo)

# matchingo

Incredibly fast matching engine for HFT (high-frequency trading) written in JS

### Features

- order types: **LIMIT**, **MARKET**, **MARKET QUOTE** (money budget), **MARKET-TO-LIMIT**, **STOP-LIMIT**, **STOP-MARKET**,
  **TRAILING STOP**, **iceberg**, **post-only**
- _time-in-force_: **GTC**, **IOC**, **FOK**, **GTD** (expiry timestamp or TTL)
- price-time priority: best price first, then the oldest order; trades happen at the maker price
- **OCO**, self-trade prevention (5 modes), trading halt, circuit breaker, instrument rules (tick, lot, quantity and price bounds)
- cancel, modify, modify-stop and atomic replace
- snapshots (`dump()` / `restore()`) and a write-ahead log with replay (`replay()`) for crash recovery
- the engine is deterministic: the same configuration, state, commands and clock readings give the same book, trades and IDs
- supports EventEmitter for outbound signals
- `AsyncMatchingo`: a wrapper that makes the engine safe for concurrent async callers
- well tested code

### Scope

Matchingo is a **matching engine only**. It does not store accounts or balances,
and it does not check that order IDs are unique over time (this is the task of the library user).
It matches orders, keeps the order book in memory, and sends events.
It is a single-instrument book; create one `Matchingo` per symbol.

### Backup and restore

`dump()` returns a plain, JSON-serializable object with the whole state: sequence, trade ID, the last log position,
the halt flag, the last trade price, every resting order in queue order, every dormant stop and the pending OCO triggers.
`restore(snapshot)` clears the current state and loads it back. Snapshots carry a version (`v: 2`); an unknown version is refused.

```js
const json = JSON.stringify(matchingo.dump());

// later, in a new process (configured the same way):
const matchingo2 = new Matchingo("BTC/USD", { priceScale: 2, amountScale: 8 });
matchingo2.restore(JSON.parse(json));
```

The dump uses internal integers, not decimals. MARKET orders never rest, so they are never in the dump.

### Write-ahead log and recovery

Attach a log sink and every state-changing command (`submit`, `replace`, `cancel`, `modify`, `modifyStop`, `expire`,
`halt`, `resume`) is written **before** it is applied. Rejected commands and commands that change nothing are not logged.

```js
import Matchingo, { MemoryWal, readWal } from "matchingo";

const wal = new MemoryWal(); // or your own sink
const matchingo = new Matchingo("BTC/USD", {
	priceScale: 2,
	amountScale: 8,
	wal,
});
```

A sink is any object with `write(line: string)`; the engine calls its optional `sync()` after every record, so a file
sink can flush to disk. Each record is one JSON line: `{ lsn, time, op, ... }`. The log is a stream: the library does
not open files or rotate them.

- the book clock is **frozen to the logged `time`** while the command runs, so live execution equals replay
- if the sink throws, the command is **not applied**, the error (`WAL_FAILURE`) is latched and every later command is
  refused until you call `matchingo.attachWal(sink)` again

Recovery is the latest snapshot plus the log after it:

```js
const matchingo = new Matchingo("BTC/USD", { priceScale: 2, amountScale: 8 }); // same configuration
matchingo.restore(snapshot); // optional
matchingo.replay(readWal(logText));
```

- `readWal(text)` parses the lines and ignores a torn last line (a crash in the middle of a write; the command was never applied)
- `replay(records)` skips the records the snapshot already has, requires consecutive `lsn` (a gap throws `WAL_GAP`),
  uses each record's `time` as the clock and writes nothing to the log
- configure the book exactly as when the log was written (scales, instrument, circuit breaker)

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

##### Instrument rules

An optional instrument definition checks every order and modification:

```js
const matchingo = new Matchingo("BTC/USD", {
	priceScale: 2,
	amountScale: 8,
	instrument: {
		tickSize: "0.01", // prices (limit and stop) must be multiples
		lotSize: "0.00000001", // amounts must be multiples (icebergs: the visible and the hidden slice)
		minQuantity: "0.001", // bounds of the total quantity (icebergs: the total)
		maxQuantity: 1000,
		minPrice: 1, // price band for limit and stop prices
		maxPrice: 1000000,
	},
});
```

- a missing or zero field means "unchecked"
- a negative field, or min greater than max, throws `INVALID_INSTRUMENT` at construction
- quote orders (money budgets) are exempt from lot and quantity checks
- violations are rejected before the book is touched
- results, events and `depth()` return normal decimals
- `matchingo.order(id)` returns a **copy** of the order with decimals; `Matchingo.decimalFrom(value, scale)` returns a scaled integer

##### Sequence, trade IDs and the clock

- **sequence** increases by one for every accepted new order, including the new order of a `replace` and a modify that re-queues an order
- **trade ID** increases by one for every fill
- **timestamp** is the clock reading when the order is accepted; if you set `order.timestamp` yourself, it is kept and the clock is not read
- the clock is injectable (`clock: () => unixMs`, default `Date.now`), so tests and replays are fully deterministic

### Installation (**temporary unavailable, use git clone**)

```
npm i matchingo
```

### Usage

#### Order instance creation

Orders are built with factory methods, then sent with `submit`. Each factory throws a `MatchingoError` for an invalid value.

- `newLimitOrder(id, side, price, amount)`
- `newMarketOrder(id, side, baseAmount)` - market orders never rest; the unfilled remainder is canceled and a market order is always IOC
- > only if you understand QUOTE mode, use `newMarketBuyQuoteOrder(id, quoteAmount)` or `newMarketSellQuoteOrder(id, quoteAmount)`
- `newMarketToLimitOrder(id, side, baseAmount)` - a market order whose remainder rests as a limit order at the price of its
  last fill; with no fill, or stopped by self-trade prevention, it is canceled
- `newPostOnlyLimitOrder(id, side, price, amount)` - **canceled** (not rejected, never traded) if it would match at once
- `newIcebergOrder(id, side, price, amount, peakAmount)` - only `peakAmount` is visible; the next slice is re-posted at the back of the level
  (it loses time priority); `peakAmount` must be less than `amount`. A resting iceberg's hidden part counts for FOK checks and `estimate`
- `newStopLimitOrder(id, side, stop, price, amount)`
- `newStopMarketOrder(id, side, stop, amount)`
- `newTrailingStopOrder(id, side, stop, amount, { offset } | { percent })` - a stop-market whose stop price follows the trade price
  at a fixed distance (`offset` in price units, or `percent` strictly between 0 and 100); `stop` is the initial stop price.
  A SELL stop only moves up, a BUY stop only down

Options on an order (all chainable):

- `order.setTIF(Matchingo.IOC | Matchingo.FOK | Matchingo.GTC)`
- `order.setExpiry(unixMs)` - good-till-date (sets TIF to `Matchingo.GTD`); `order.setTTL(ms)` - expires `ms` after acceptance (GTC only)
- `order.setOCO(partnerId)`
- `order.setSTP(traderId, mode)` - self-trade prevention, see below

Constants: `Matchingo.BUY` (1), `Matchingo.SELL` (2), `Matchingo.MARKET`, `Matchingo.LIMIT`, `Matchingo.STOP_LIMIT`,
`Matchingo.STOP_MARKET`, `Matchingo.TRAILING_STOP`, `Matchingo.GTC`, `Matchingo.GTD`, `Matchingo.IOC`, `Matchingo.FOK`,
`Matchingo.STP_NONE`, `Matchingo.STP_CANCEL_NEWEST`, `Matchingo.STP_CANCEL_OLDEST`, `Matchingo.STP_CANCEL_BOTH`, `Matchingo.STP_DECREMENT`.

> A stop order may carry a time in force; it applies once the stop activates. GTD on a stop also expires the dormant order.
> Market orders cannot expire. FOK cannot be combined with self-trade prevention.

#### Commands

- `matchingo.submit(order): Done` - accept an order. Throws when rejected; a rejected order changes nothing
- `matchingo.replace(oldId, order): Done` - atomic cancel-and-submit. The new order is validated first; if it is invalid the old
  order stays. The new order may reuse the old ID and goes to the back of its queue; the old ID is first in `canceled`
- `matchingo.cancel(id): boolean` - removes a resting or dormant order; `false` if there is no such order. Works while halted
- `matchingo.modify(id, newPrice, newAmount): Done` - modify a resting limit order (`newAmount` is the new unfilled amount).
  Same price and a smaller or equal amount: **in place**, the order keeps its time priority. Anything else: the order is removed and
  submitted again at the back of the new level (it can match at once). An iceberg is always re-submitted
- `matchingo.modifyStop(id, newStop, newPrice, newAmount): Done` - modify a dormant stop order (`newPrice` is ignored for stop-market
  and trailing stops); it goes to the back of its new stop level
- `matchingo.expire(at?): id[]` - cancel everything whose expiry is reached at `at` (unix ms; the clock by default)
- `matchingo.halt()` / `matchingo.resume()` - see "Market controls"

##### Result

`submit`, `replace`, `modify` and `modifyStop` return a **done** object:

- **order**: a copy of the processed order (decimals)
- **sequence**: the sequence number of the command
- **trades**: empty if nothing traded; otherwise the first element is a **summary of the taker** (`id`, `price` - the order's own price, 0 for
  market orders, `amount` - total matched, `role` 70), followed by **one element per fill** with the maker's `id`, `tradeId`,
  trade `price`, `amount` and `role` 80
- **quantity**: the original amount of this run; **processed** + **left** = **quantity**
  (for market-quote orders all three are in quote units, and `trades[0].isQuote` is `true`)
- **stored**: `true` if the remainder now rests in the book (or the stop is waiting in the stop book)
- **canceled**: IDs of every order canceled by this command: the order itself (IOC remainder, FOK, post-only, market remainder, self-trade stop),
  self-trade victims, OCO partners, expired orders
- **activated**: IDs of the stop orders fired by the trades of this order
- **activations**: one **done** object for each activated stop, in the order of activation. An activated stop is processed like a new
  order after the current order is complete; stops fired by those trades are nested in their `activations`

```
{
    "order": {"id": "order2", "price": 10.111, "isQuote": false, "amount": 10, "open": 0, "...": "..."},
    "sequence": 2,
    "trades": [
        {"id": "order2", "price": 10.111, "isQuote": false, "amount": 10, "role": 70},
        {"tradeId": 1, "id": "order1", "price": 10.111, "isQuote": false, "amount": 10, "role": 80}
    ],
    "processed": 10,
    "left": 0,
    "quantity": 10,
    "stored": false,
    "canceled": [],
    "activated": [],
    "activations": []
}
```

#### Time in force

| TIF               | Behavior                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **GTC** (default) | the remainder rests until filled or canceled                                                                                                |
| **IOC**           | match what is possible, the remainder is canceled                                                                                           |
| **FOK**           | the whole amount must be fillable at prices within the limit (hidden iceberg volume counts), otherwise the order is canceled with no trades |
| **GTD**           | rests until its expiry (`expiry <= now` cancels it); an expiry already in the past is rejected                                              |

Expiry is enforced **lazily**: before every new order is processed, if the clock reached the earliest expiry, all due orders are canceled
(by expiry, ties by ID) and appear in that order's `canceled`. Call `expire()` from a timer to enforce it on an idle book.

##### OCO orders

Call `order.setOCO(partnerId)` to name a partner. When the order **executes to completion** - a taker that is fully matched, a market
order that traded, or a resting maker (an iceberg: its whole total) that is completely filled - the partner is canceled and
appears in `canceled`. **A partial fill alone does not trigger OCO.** If the partner is not in the book yet, the trigger is remembered
(and saved in snapshots); when the partner arrives later, it is canceled at once. Partners may be limit orders or stop orders.

##### Self-trade prevention

`order.setSTP(traderId, mode)`. When the incoming order meets a resting order with the same `traderId`, the mode of the incoming order decides:

| Mode                | Effect                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `STP_NONE`          | the self-trade is allowed                                                                 |
| `STP_CANCEL_NEWEST` | the incoming remainder stops and is canceled; the resting order stays                     |
| `STP_CANCEL_OLDEST` | the resting order is canceled; matching goes on                                           |
| `STP_CANCEL_BOTH`   | the resting order is canceled and the incoming remainder is canceled                      |
| `STP_DECREMENT`     | both are reduced by the overlap **without a trade**; an emptied resting order is canceled |

Earlier trades of the same run stay valid. Decrement on a market-quote order acts as cancel-newest. An order with a mode but no `traderId` is rejected.

##### STOP orders

- a dormant stop is not part of the book: it never matches and never appears in depth, best bid/ask or volume
- the engine checks the stops after each price level that traded, with the price of that level
- a **BUY** stop activates when `stop <= trade price`; a **SELL** stop when `stop >= trade price`
- **only trades trigger stops**: submitting a stop never activates it at once, even if the last trade price is already past the stop
- stops are collected BUY first, then SELL; in stop price order (BUY: lowest first, SELL: highest first), then in arrival order
- an activated stop-limit becomes a limit order at its limit price (and rests if nothing matches); an activated stop-market or
  trailing stop becomes a market order (canceled if there is no liquidity)

#### Market controls

- `matchingo.halt()` rejects all new orders and amendments (`submit`, `replace`, `modify`, `modifyStop`) with `TRADING_HALTED`.
  Cancels and expiry still work and the book stays intact. `matchingo.resume()` reopens trading; `matchingo.halted` is the flag
- **circuit breaker**: `new Matchingo(symbol, { circuitBreaker: 10 })`. After trading at a price level the engine compares it with the previous trade price;
  if the absolute move is more than 10 percent the book **halts**. The order that caused it finishes normally (more matches, stop
  activations); only later orders are rejected. The last trade price survives halts, resumes and snapshots. The first trade never trips it

#### Queries

- `matchingo.order(id)` - a copy of the order, or `null`
- `matchingo.depth()` - volume for each price: `{"BTC/USD":{"1":{"10.111":10},"2":{}}}` (`1` is **BUY**, `2` is **SELL**)
- `matchingo.bestBid()` / `matchingo.bestAsk()` - `{ price, amount }` of the best level, or `null`
- `matchingo.level(side, price)` - `{ price, amount }` resting at that price, or `null`
- `matchingo.estimate(side, amount)` - the cost (BUY) or proceeds (SELL) of taking `amount` from the opposite side, level by level;
  throws `INSUFFICIENT_VOLUME` if the book is too thin. It does not change the book

### Errors

Every rejection throws a `MatchingoError` with a `code` (see `ErrorCode`) and leaves the book unchanged:

`INVALID_ORDER`, `INVALID_SIDE`, `INVALID_QUANTITY`, `INVALID_PRICE`, `INVALID_TIF`, `ALREADY_CANCELED`, `DUPLICATE_ORDER_ID`,
`ORDER_NOT_FOUND`, `WRONG_ORDER_KIND`, `QUANTITY_PRECISION`, `PRICE_PRECISION`, `TICK_SIZE`, `LOT_SIZE`, `QUANTITY_RANGE`, `PRICE_BAND`,
`INVALID_INSTRUMENT`, `ORDER_EXPIRED`, `INVALID_STP`, `TRADING_HALTED`, `INSUFFICIENT_VOLUME`, `WAL_FAILURE`, `WAL_GAP`,
`INVALID_WAL_RECORD`, `INVALID_SNAPSHOT`.

```js
import Matchingo, { ErrorCode, MatchingoError } from "matchingo";

try {
	matchingo.submit(order);
} catch (error) {
	if (
		error instanceof MatchingoError &&
		error.code === ErrorCode.TRADING_HALTED
	) {
		// ...
	}
}
```

### Concurrency

The engine is synchronous, so every command is atomic. If several async callers share one book, wrap it:

```js
import Matchingo, { AsyncMatchingo } from "matchingo";

const book = new AsyncMatchingo(
	new Matchingo("BTC/USD", { priceScale: 2, amountScale: 8 }),
);
const done = await book.submit(book.newLimitOrder("a", Matchingo.BUY, 10, 1));
```

Commands (`submit`, `replace`, `cancel`, `modify`, `modifyStop`, `expire`, `halt`, `resume`, `restore`, `replay`, `attachWal`) take an exclusive lock and run one
at a time in call order, so the outcome equals some sequential order - the order the log records. Queries (`order`, `depth`, `bestBid`,
`bestAsk`, `level`, `estimate`, `dump`) share a read lock. The factory methods (`newLimitOrder`, ...) are available on the wrapper.
Event listeners and the log sink run under the lock: they must not wait for the wrapper, or they deadlock.

### Events

Enable events by passing `emitter: true`, then listen by event name:

```js
const matchingo = new Matchingo("BTC/USD", {
	priceScale: 3,
	amountScale: 3,
	emitter: true,
});

matchingo.emitter.on("trade", (event) => {});
```

Events are sent synchronously while the command runs. Each listener receives a single object; all events include `symbol`
and the current `sequence`. Side values are numbers (`1` BUY, `2` SELL). Listeners must not call back into the book.

- **trade** - every fill: `{ tradeId, makerId, takerId, price, amount }`
- **volume** - the resting volume at a price level changed (order added, filled, removed, reduced, self-trade decrement, iceberg refill): `{ side, price, volume }`; `volume: 0` means the level is gone
- **canceled** - an order was canceled for any reason: `{ id }`
- **activated** - a stop order was triggered: `{ id }`
- **bbo** - the best bid or best ask changed after a command: `{ bid: { price, amount } | null, ask: { price, amount } | null }`
- **depth** - whenever `depth()` is called: `{ depth }`
- **halt** - trading halted or resumed: `{ halted, circuitBreaker }` (`circuitBreaker` is `true` when the breaker caused it)

### Example

```
import Matchingo from "matchingo";

const matchingo = new Matchingo("BTC/USD", { priceScale: 3, amountScale: 3 });

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
```

### License

**matchingo** is open-source software licensed under the [MIT License](LICENSE.md).

### Author

Built by [Vano Devium](https://github.com/vanodevium/)

Made with ❤️ in Ukraine

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/vanodevium)
