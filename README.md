![GitHub](https://img.shields.io/github/license/vanodevium/matchingo)

# matchingo

Incredibly fast matching engine for HFT (high-frequency trading) written in JS

### Features

- supports **MARKET**, **LIMIT**, **STOP-LIMIT**, **OCO** order types
- supports _time-in-force_ (**GTK**, **FOK**, **IOC**) parameters for **LIMIT** orders
- supports EventEmitter for outbound signals
- well tested code

### Coming features

- state backup/restore functionality
- ...

##### Order amount caution

> **It is very important!** Each SYMBOL is a combination of BASE and QUOTE currencies.
> For example, **BTC/USD** where **BTC** is **BASE** currency, **USD** is **QUOTE** currency.

Each order **MUST HAVE** _amount_ parameter but **pay attention**:
if you want to mitigate **double spending**, you have to pass **QUOTE amount** for **MARKET BUY** orders.
If you don't need to freeze money, feel free use **BASE amount**.

> This may seem inconvenient, but it is a precautionary measure for **double spending**: when a user places a
> **MARKET** **BUY** in asynchronous way, you will be able to freeze the correct amount on his balance.

### Installation (**temporary unavailable, use git clone**)

```
npm i matchingo
```

### Usage

#### Order instance creation

- `matchingo.newMarketOrder(id: string, side: Side, baseAmount: number)`
- > only if you understand QUOTE mode, use `matchingo.newMarketBuyQuoteOrder(id: string, quoteAmount: number)` or 
  > `matchingo.newMarketSellQuoteOrder(id: string, quoteAmount: number)` 

- `matchingo.newLimitOrder(id: string, side: Side, price: number, amount: number)`
- `matchingo.newStopLimitOrder(id: string, side: Side, stop: number, price: number, amount: number)`

> For OCO orders use `order.setOCO(id: string)`

#### Order processing

- `matchingo.process(order: Order)`

##### processing result

> sometimes, process() returns undefined or boolean

**process()** returns **done** object for **MARKET** and **LIMIT** orders which contains:

- **order**: exactly processed order
  - **id**: order ID
  - **price**: concrete trade price
  - **isQuote**: _true_ if order's amount was in Quote format
  - **amount**: concrete trade amount
  - **role**: role (**TAKER** or **MAKER**)
- **trades**: array of orders; is filled when there was matching; if not empty, first element is exactly processed order
  - **id**: order ID
  - **price**: concrete trade price
  - **isQuote**: _true_ if order's amount was in Quote format
  - **amount**: concrete trade amount
  - **role**: role (**TAKER** or **MAKER**)
- **left**: value of left amount for this processing, can be zero
- **processed**: value of processed amount for this processing, can be zero
- **canceled**: array of order IDs which was cancelled for this processing (**IOC**, **OCO**), can be empty
- **activated**: array of order IDs which was activated for this processing (**STOP** orders), can be empty

For instance:
```
{
    "order": {
        "id": "main",
        "price": 111,
        "isQuote": false,
        "amount": 50,
        "role": "TAKER"
    },
    "trades": [{
        "id": "main",
        "price": 111,
        "isQuote": false,
        "amount": 50,
        "role": "TAKER"
    }, {
        "id": "order10",
        "price": 111,
        "isQuote": false,
        "amount": 10,
        "role": "TAKER"
    }, {
        "id": "order11",
        "price": 111,
        "isQuote": false,
        "amount": 10,
        "role": "TAKER"
    }, {
        "id": "order12",
        "price": 111,
        "isQuote": false,
        "amount": 10,
        "role": "TAKER"
    }, {
        "id": "order13",
        "price": 111,
        "isQuote": false,
        "amount": 10,
        "role": "TAKER"
    }, {
        "id": "order14",
        "price": 111,
        "isQuote": false,
        "amount": 10,
        "role": "TAKER"
    }],
    "processed": 50,
    "left": 61,
    "canceled": ["canceled"],
    "activated": ["activated"]
}
```

#### Order cancellation

- `matchingo.cancel(id: string): bool`


### Events

You can enable **events** mode by passing **true** as second argument, for instance:

```
const matchingo = new Matchingo("BTC/USD", true);
matchingo.emitter.on("BTC/USD", (event) => {})
```

Each event has own type:

- **volume**: when volume for some price was changed
```
{"symbol":"BTC/USD","type":"volume","side":"BUY",price":10.111,"volume":10}
```
- **depth**: when depth was changed
```
{"symbol":"BTC/USD","type":"depth","depth":{"BTC/USD":{"BUY":{"10.111":10},"SELL":{}}}}
```
- **activated**: when was activated some **STOP-LIMIT** order
```
{"symbol":"BTC/USD","type":"activated","id":"activatedOrderID"}
```
- **canceled**: when was canceled some order
```
{"symbol":"BTC/USD","type":"canceled","id":"canceledOrderID"}
```
- **trade**: when was some trade
```
{"symbol":"BTC/USD","type":"trade","trade":{"id":"order1","price":10.111,"isQuote":false,"amount":10,"role":"MAKER"}}
```

### Example

```
const Matchingo = require("matchingo");

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
```

### Benchmark

```
os: linux
arch: amd64
cpu: Intel(R) Core(TM) i7-8565U CPU @ 1.80GHz

❯ node benchmarks/matching.js
NANOBENCH version 2
> /usr/bin/node benchmarks/matching.js

# Match 10 000 new Limits
ok ~44 ms (0 s + 44280734 ns)

# Match 10 000 new Limits different prices
ok ~47 ms (0 s + 47185364 ns)

# Match 100 000 new Limits
ok ~101 ms (0 s + 100913675 ns)

# Match 1M new Limits
ok ~836 ms (0 s + 836485826 ns)

# Match 2M new Limits
ok ~1.92 s (1 s + 918657706 ns)

# Match 3M new Limits
ok ~2.88 s (2 s + 877035219 ns)

all benchmarks completed
ok ~5.82 s (5 s + 824558524 ns)

```

### License

**matchingo** is open-sourced software licensed under the [MIT license](./LICENSE.md).

[Vano Devium](https://github.com/vanodevium/)

---

Made with ❤️ in Ukraine

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/vanodevium)
