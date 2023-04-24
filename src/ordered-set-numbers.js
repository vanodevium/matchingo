const createTree = require("functional-red-black-tree");

class OrderedSetNumbers {
  constructor(sort) {
    this.numbers = {};
    switch ((sort || "").toLowerCase()) {
      case "asc":
        this.keys = createTree((a, b) => a - b);
        break;
      case "desc":
        this.keys = createTree((a, b) => b - a);
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
        this.keys = this.keys.insert(key, key);
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
        this.keys = this.keys.remove(key);
      }
    }
  }

  geyKeys() {
    return this.keys;
  }

  getRaw() {
    return this.numbers;
  }
}

module.exports = OrderedSetNumbers;
