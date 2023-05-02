const {
  FOK,
  IOC,
  BUY,
  SELL,
  MARKET,
  LIMIT,
  STOP_LIMIT,
} = require("./constants");
const OrdersCollection = require("./orders-collection");
const OrderBook = require("./order-book");
const StopBook = require("./stop-book");
const Trade = require("./models/trade");
const Done = require("./models/done");
const Emitter = require("./emmiter");
const {
  createMarketOrder,
  createLimitOrder,
  createStopLimitOrder,
} = require("./new-order");

/**
 * @typedef {"BUY"|"SELL"} Side
 */

class Matchingo {
  constructor(symbol, emit) {
    if (!symbol) {
      throw new Error("please set up symbol");
    }

    this.symbol = symbol;
    this.orderBook = new OrderBook(this.symbol);
    this.stopBook = new StopBook(this.symbol);

    this._orders = new OrdersCollection();
    this._activated = new OrdersCollection();
    this._canceled = new OrdersCollection();
    this._oco = new OrdersCollection();

    this._emit = emit || false;
    this.emitter = new Emitter(this.symbol);
  }

  /**
   * @param {string|number} id
   * @param {Side} side
   * @param {number} baseAmount
   * @returns {Order}
   */
  newMarketOrder(id, side, baseAmount) {
    return createMarketOrder(this.symbol, id, side, baseAmount);
  }

  /**
   * @param {string|number} id
   * @param {number} quoteAmount
   * @returns {Order}
   */
  newMarketBuyQuoteOrder(id, quoteAmount) {
    const order = createMarketOrder(this.symbol, id, BUY, quoteAmount);
    order.setQuoteMode();
    return order;
  }

  /**
   * @param {string|number} id
   * @param {number} quoteAmount
   * @returns {Order}
   */
  newMarketSellQuoteOrder(id, quoteAmount) {
    const order = createMarketOrder(this.symbol, id, SELL, quoteAmount);
    order.setQuoteMode();
    return order;
  }

  /**
   * @param {string|number} id
   * @param {Side} side
   * @param {number} price
   * @param {number} amount
   * @returns {Order}
   */
  newLimitOrder(id, side, price, amount) {
    return createLimitOrder(this.symbol, id, side, price, amount);
  }

  /**
   * @param {string|number} id
   * @param {Side} side
   * @param {number} stop
   * @param {number} price
   * @param {number} amount
   * @returns {StopLimitOrder}
   */
  newStopLimitOrder(id, side, stop, price, amount) {
    return createStopLimitOrder(this.symbol, id, side, stop, price, amount);
  }

  /**
   * @param {Order} order
   */
  add(order) {
    this._checkSymbol(order);

    if (order.isLimit()) {
      this.orderBook.append(order) && this._increaseVolume(order);
      return;
    }

    if (order.isStopLimit()) {
      this.stopBook.append(order);
    }
  }

  /**
   * @param {string|number} id
   * @returns {boolean}
   */
  cancel(id) {
    const order = this.orderBook.find(id) || this.stopBook.find(id);

    if (!order) {
      return false;
    }

    if (order.isLimit()) {
      this.orderBook.remove(order);
      this._decreaseVolume(order, order.open_amount);
      return true;
    }

    if (order.isStopLimit()) {
      this.stopBook.remove(order);
      return true;
    }

    return false;
  }

  /**
   * @param {Order} order
   */
  process(order) {
    if (!order) {
      return;
    }

    if (this.order(order.id)) {
      return false;
    }

    this._reset();

    if (this._checkCancelOCO(order)) {
      this._cancelOrder(order);
      this._processCanceled();
      return this._matchingOrderResult(order);
    }

    if (order.isStopLimit()) {
      this.add(order);
      return true;
    }

    if (order.isMarket()) {
      order.setTIF(IOC);
    }

    if (order.isLimit()) {
      if (
        FOK === order.tif &&
        !this.orderBook.volume.hasEnough(
          order.oppositeSide(),
          order.price,
          order.amount,
        )
      ) {
        this._cancelOrder(order);
        this._processCanceled();
        return this._matchingOrderResult(order);
      }
    }

    this._matchOrders(order);

    const trade = new Trade(order, []);

    if (this._orders.size()) {
      this._orders.orders.forEach((order) => {
        this._decreaseVolume(order, order.tradeAmount);
      });
      trade.setOrders(this._orders.toArray());
    }

    if (order.tif === IOC) {
      if (order.isQuote() && trade.left > 0) {
        this._cancelOrder(order);
      }

      if (!order.isQuote() && !order.isFulfilled()) {
        this._cancelOrder(order);
      }
    }

    this._canceled.size() && this._processCanceled();

    if (order.isLimit() && !order.isCanceled() && !order.isFulfilled()) {
      this.add(order);
    }

    return this._matchingOrderResult(order, trade);
  }

  /**
   * @param {string|number} id
   * @returns {?Order}
   */
  order(id) {
    return this.orderBook.find(id) || this.stopBook.find(id);
  }

  depth() {
    this._emit && this.emitter.depth({ depth: this.orderBook.volume.getRaw() });
    return this.orderBook.volume.getRaw();
  }

  // -----------------------------------------------------------------------

  /**
   * @param {Order} order
   */
  _matchOrders(order) {
    if (order.isMaker()) {
      throw Error("Order with MAKER role as order argument for matchOrders");
    }

    let amount = order.open_amount;
    if (!amount) {
      return;
    }

    let iter = this.orderBook.next(order);
    while (amount > 0 && !iter.done) {
      amount = this._processQueue(iter.key, iter.value, order, amount);
      this.stopBook.activate(iter.key, this.orderBook).map((order) => {
        if (!order.isActivated()) {
          return;
        }
        this.add(order);
        this._activated.append(order);
      });
      iter = this.orderBook.next(order);
    }
  }

  _processQueue(price, queue, order, amount) {
    while (queue.size()) {
      if (order.isFulfilled()) {
        break;
      }

      const limitOrder = queue.front();

      if (this._checkCancelOCO(limitOrder)) {
        this._cancelOrder(limitOrder);
        continue;
      }

      const tradePrice = this.orderBook.comparator.compare(order, limitOrder);
      if (!tradePrice) {
        amount = 0;
        break;
      }

      let tradeAmount = 0;

      if (order.isQuote()) {
        tradeAmount = limitOrder.getMaxAmount(
          this._convertQuoteToBase(price, amount),
        );
        tradeAmount = this._convertBaseToQuote(price, tradeAmount);
      } else {
        tradeAmount = limitOrder.getMaxAmount(amount);
      }

      if (tradeAmount === 0) {
        break;
      }

      amount -= tradeAmount;

      if (this._increase(order, limitOrder, tradePrice, tradeAmount)) {
        continue;
      }

      if (order.isFulfilled()) {
        break;
      }
    }

    return amount;
  }

  _increase(order, orderBookOrder, tradePrice, tradeAmount) {
    if (tradeAmount === 0) {
      throw new Error("increase method received zero amount!");
    }

    order.increase(tradeAmount, tradePrice);

    this._cancelOCO(order);

    if (orderBookOrder.increase(tradeAmount, tradePrice, order.isQuote())) {
      orderBookOrder.tradePrice = tradePrice;

      if (orderBookOrder.isFulfilled()) {
        orderBookOrder.delete();
        this._fastRemove(orderBookOrder);
      }

      this._cancelOCO(orderBookOrder);

      this._orders.append(orderBookOrder);

      if (orderBookOrder.isDeleted()) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {Order} order
   */
  _checkCancelOCO(order) {
    return this._oco.has(order.getKey());
  }

  /**
   * @param {Order} order
   */
  _cancelOCO(order) {
    if (!order.oco) {
      return;
    }

    this._oco.append(order.oco);

    let canceled;
    canceled = this.stopBook.cancel(order.oco);
    if (canceled) {
      this._cancelOrder(canceled);
    }
    canceled = this.orderBook.find(order.oco);
    if (canceled) {
      this._cancelOrder(canceled);
    }
  }

  /**
   * @param {Order} order
   */
  _cancelOrder(order) {
    order.cancel();
    this._remove(order);
    this._canceled.append(order);
  }

  _processCanceled() {
    this._canceled.orders.forEach((order) => {
      this._decreaseVolume(order, order.open_amount);
      this._oco.remove(order.getKey());
    });
  }

  /**
   * @param {Order} order
   */
  _remove(order) {
    if (!order.hasSymbol(this.symbol)) {
      throw Error("incorrect symbol: " + order.symbol);
    }

    return this.orderBook.remove(order);
  }

  /**
   * @param {Order} order
   * @param {Trade|null} trade
   */
  _matchingOrderResult(order, trade = null) {
    if (!trade) {
      trade = new Trade(order, this._orders.toArray());
    }

    const done = new Done(
      trade,
      this._canceled.toArray(),
      this._activated.toArray(),
    );

    if (this._emit) {
      done.trades.map((trade) => {
        this.emitter.trade({ trade });
      });
      done.canceled.map((id) => {
        this.emitter.canceled({ id });
      });
      done.activated.map((id) => {
        this.emitter.activated({ id });
      });
    }

    return done;
  }

  /**
   * @param {Order} order
   */
  _fastRemove(order) {
    return this.orderBook.fastRemove(order);
  }

  /**
   * @param {Order} order
   */
  _checkSymbol(order) {
    if (!order.hasSymbol(this.symbol)) {
      throw Error("incorrect symbol: " + order.symbol);
    }
  }

  _reset() {
    this._orders.reset();
    this._activated.reset();
    this._canceled.reset();
  }

  _convertQuoteToBase(price, amount) {
    return amount / price;
  }

  _convertBaseToQuote(price, amount) {
    return amount * price;
  }

  /**
   * @param {Order} order
   */
  _increaseVolume(order) {
    this.orderBook.volume.increase(order, order.price, order.open_amount);
    this._emitVolume(order);
  }

  /**
   * @param {Order} order
   * @param {number} value
   */
  _decreaseVolume(order, value) {
    this.orderBook.volume.decrease(
      order,
      order.price,
      value || order.tradeAmount || order.amount,
    );
    this._emitVolume(order);
  }

  _emitVolume(order) {
    this._emit &&
      this.emitter.volume({
        side: order.side,
        price: order.price,
        volume: this.orderBook.volume.getVolume(order),
      });
  }
}

Matchingo.SELL = SELL;
Matchingo.BUY = BUY;

Matchingo.MARKET = MARKET;
Matchingo.LIMIT = LIMIT;
Matchingo.STOP_LIMIT = STOP_LIMIT;

Matchingo.IOC = IOC;
Matchingo.FOK = FOK;

module.exports = Matchingo;
