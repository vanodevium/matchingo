const { EventEmitter } = require("events");
const { FOK, IOC, MAKER } = require("./constants");
const OrdersCollection = require("./orders-collection");
const OrderBook = require("./order-book");
const StopBook = require("./stop-book");
const Trade = require("./models/trade");
const Done = require("./models/done");

class Matcher extends EventEmitter {
  constructor(symbol) {
    super();

    if (!symbol) {
      throw new Error("please set up symbol");
    }

    this.symbol = symbol;
    this.orderBook = new OrderBook(this.symbol);
    this.stopBook = new StopBook(this.symbol);

    this.orders = new OrdersCollection();
    this.activated = new OrdersCollection();
    this.canceled = new OrdersCollection();
    this.oco = new OrdersCollection();
  }

  /**
   * @param {Order} order
   */
  increaseVolume(order) {
    this.orderBook.volume.increase(order, order.price, order.open_amount);
    this.emit("event", {
      type: "volume",
      symbol: this.symbol,
      volume: this.orderBook.volume.getRaw(),
    });
  }

  /**
   * @param {Order} order
   * @param {number} value
   */
  decreaseVolume(order, value) {
    this.orderBook.volume.decrease(
      order,
      order.price,
      value || order.tradeAmount || order.amount
    );
    this.emit("event", {
      type: "volume",
      symbol: this.symbol,
      volume: this.orderBook.volume.getRaw(),
    });
  }

  setLastPrice(price) {
    this.orderBook.lastPrice.set(price);
    this.emit("event", { type: "actual", symbol: this.symbol, price: price });
  }

  /**
   * @param {Order} order
   */
  add(order) {
    this._checkSymbol(order);

    if (order.isLimit()) {
      order.setRole(MAKER);
      this.orderBook.append(order) && this.increaseVolume(order);
    }

    if (order.isStopLimit()) {
      this.stopBook.append(order);
    }
  }

  /**
   * @param {Order} order
   */
  remove(order) {
    if (!order.hasSymbol(this.symbol)) {
      throw Error("incorrect symbol: " + order.symbol);
    }

    return this.orderBook.remove(order);
  }

  /**
   * @param {Order} order
   */
  _fastRemove(order) {
    if (!order.hasSymbol(this.symbol)) {
      throw Error("incorrect symbol: " + order.symbol);
    }

    return this.orderBook.fastRemove(order);
  }

  /**
   * @param {Order} order
   */
  match(order) {
    if (!order) {
      return;
    }

    if (order.isStopLimit()) {
      this.add(order);
      return order;
    }

    this._reset();

    if (this._checkCancelOCO(order)) {
      this.cancelOrder(order);
      this._processCanceled();
      return this._matchingOrderResult(order);
    }

    if (order.isMarket()) {
      order.setTIF(IOC);
      this._matchOrders(order);
    }

    if (order.isLimit()) {
      if (
        FOK === order.tif &&
        !this.orderBook.volume.hasEnough(
          order.oppositeSide(),
          order.price,
          order.amount
        )
      ) {
        this.cancelOrder(order);
        this._processCanceled();
        return this._matchingOrderResult(order);
      }

      this._matchOrders(order);
    }

    this.orders.size() &&
      this.orders.orders.forEach((order) => {
        this.decreaseVolume(order, order.tradeAmount);
        if (order.isLimit() && order.isFulfilled()) {
          this.setLastPrice(order.tradePrice);
        }
      });

    const trade = new Trade(order, this.orders.toArray());

    if (order.tif === IOC) {
      if (order.isQuote() && trade.leftQuote) {
        this.cancelOrder(order);
      }

      if (!order.isQuote() && !order.isFulfilled()) {
        this.cancelOrder(order);
      }
    }

    this.canceled.size() && this._processCanceled();

    if (order.isLimit() && !order.isCanceled() && !order.isFulfilled()) {
      this.add(order);
    }

    return this._matchingOrderResult(order, trade);
  }

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

    let queue;
    while (amount > 0 && (queue = this.orderBook.getBestQueue(order))) {
      amount = this._processQueue(queue, order, amount);
    }
  }

  _adaptAmountBase(price, amount) {
    return amount / price;
  }

  _adaptAmountQuote(price, amount) {
    return amount * price;
  }

  _processQueue(queue, order, amount) {
    let orderFromOrderBook;
    while (queue.size()) {
      if (order.isFulfilled()) {
        break;
      }

      orderFromOrderBook = queue.peekFront();

      if (this._checkCancelOCO(orderFromOrderBook)) {
        this.cancelOrder(orderFromOrderBook);
        continue;
      }

      const tradePrice = this.orderBook.comparator.compare(
        order,
        orderFromOrderBook
      );
      if (!tradePrice) {
        break;
      }

      let tradeAmount = 0;
      if (order.isQuote()) {
        tradeAmount = this._adaptAmountQuote(
          orderFromOrderBook.price,
          orderFromOrderBook.getAvailableAmount(
            this._adaptAmountBase(orderFromOrderBook.price, amount)
          )
        );
        if (tradeAmount === 0) {
          break;
        }
      } else {
        tradeAmount = orderFromOrderBook.getAvailableAmount(amount);
      }

      amount -= tradeAmount;

      if (this._increase(order, orderFromOrderBook, tradePrice, tradeAmount)) {
        continue;
      }

      if (order.isFulfilled()) {
        break;
      }
    }

    if (orderFromOrderBook) {
      this.stopBook
        .activate(order.symbol, orderFromOrderBook.price, this.orderBook)
        .forEach((order) => {
          if (!order.isActivated()) {
            return;
          }
          this.add(order);
          this.activated.append(order);
        });
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

      this.orders.append(orderBookOrder);

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
    return this.oco.has(order.getKey());
  }

  /**
   * @param {Order} order
   */
  _cancelOCO(order) {
    if (!order.oco) {
      return;
    }

    this.oco.append(order.oco);

    let canceled;
    canceled = this.stopBook.cancel(order.symbol, order.oco);
    if (canceled) {
      this.cancelOrder(canceled);
    }
    canceled = this.orderBook.find(order.symbol, order.oco);
    if (canceled) {
      this.cancelOrder(canceled);
    }
  }

  /**
   * @param {Order} order
   */
  cancelOrder(order) {
    order.cancel();
    this.remove(order);
    this.canceled.append(order);
  }

  _processCanceled() {
    this.canceled.orders.forEach((order) => {
      order.isMaker() && this.decreaseVolume(order, order.open_amount);
      this.oco.remove(order.getKey());
    });
  }

  /**
   * @param {Order} order
   * @param {Trade|null} trade
   */
  _matchingOrderResult(order, trade = null) {
    if (!trade) {
      trade = new Trade(order, this.orders.toArray());
    }

    return new Done(trade, this.canceled.toArray(), this.activated.toArray());
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
    this.orders.reset();
    this.activated.reset();
    this.canceled.reset();
  }
}

module.exports = Matcher;
