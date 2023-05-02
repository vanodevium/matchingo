const { AscSortedMap, DescSortedMap } = require("./sorted-map");

/**
 * @property {AscSortedMap|DescSortedMap} keys
 */
class OrderedSetNumbers {
  constructor(sort) {
    this.numbers = {};
    switch ((sort || "").toLowerCase()) {
      case "asc":
        this.keys = new AscSortedMap();
        break;
      case "desc":
        this.keys = new DescSortedMap();
        break;
      default:
        throw new Error("set sorting");
    }
  }

  increase(key, value) {
    const exist = this.numbers[key];
    if (exist > 0) {
      this.numbers[key] = exist + value;
    } else {
      this.numbers[key] = value;
      if (value) {
        this.keys.insert(key, key);
      }
    }
  }

  decrease(key, value) {
    const exist = this.numbers[key];
    if (exist > 0) {
      this.numbers[key] = exist - value;

      if (this.numbers[key] < 0) {
        throw new Error("minus value problem for key: " + key);
      }

      if (this.numbers[key] === 0) {
        delete this.numbers[key];
        this.keys.remove(key);
      }
    }
  }

  geyKeys() {
    return this.keys.keys;
  }

  getRaw() {
    return this.numbers;
  }

  getVolume(order) {
    return this.numbers[order.price] || 0;
  }
}

module.exports = OrderedSetNumbers;
