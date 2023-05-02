/**
 * Extends Array to handle sorted data.
 */
class SortedArray extends Array {
  /**
   * The default comparator.
   *
   * @param a the first value
   * @param b the second value
   * @throws RangeError if the comparison is unstable
   */
  static compare(a, b) {
    if (a > b) return 1;
    if (a < b) return -1;
    if (a === b) return 0;
    throw new RangeError("Unstable comparison.");
  }
  /**
   * Uses binary search to find the index of an element inside a sorted array.
   *
   * @param arr the array to search
   * @param target the target value to search for
   * @param [comparator] a custom comparator
   * @param [rank=false] whether to return the element's rank if the element isn't found
   * @param [start] the start position of the search
   * @param [end] the end position of the search
   * @return the index of the searched element or it's rank
   * @example
   *
   * SortedArray.getIndex([1, 2, 3, 4, 8], 4);
   * //=> 3
   */
  static getIndex(
    arr,
    target,
    comparator = this.compare,
    rank = false,
    start = 0,
    end = arr.length - 1,
  ) {
    let left = start;
    let right = end;
    let m;
    while (left <= right) {
      m = (left + right) >> 1;
      const compared = comparator(arr[m], target);
      if (compared < 0) {
        left = m + 1;
      } else if (compared > 0) {
        right = m - 1;
      } else {
        return m;
      }
    }
    return rank ? left : -1;
  }
  /**
   * Uses binary search to quickly check if the element is the array.
   * @param element the element to check
   * @return whether the element is in the array
   */
  includes(element) {
    return !!~this.indexOf(element);
  }
  /**
   * Looks for the index of a given element in the array or -1
   *
   * @param element the element to look for
   * @return the element's index in the array or -1
   */
  indexOf(element) {
    return this.constructor.getIndex(this, element);
  }
  /**
   * Sorts the array with a provided compare function.
   *
   * @param compareFunction the function to use for comparison
   */
  sort(compareFunction = this.constructor.compare) {
    return super.sort(compareFunction);
  }
}

class AscSortedArray extends SortedArray {
  static compare(a, b) {
    return a - b;
  }
}

class DescSortedArray extends SortedArray {
  static compare(a, b) {
    return b - a;
  }
}

class SortedMap {
  constructor(sortedArray) {
    this.keys = sortedArray;
    this.keys.unique = true;
    this.values = {};
  }

  insert(key, value) {
    this.keys.push(key);
    this.keys.sort();
    this.values[key] = value;
  }

  remove(key) {
    this.keys.splice(this.keys.indexOf(key), 1);
    delete this.values[key];
  }

  fastRemoveFirst() {
    if (this.keys.length) {
      const queue = this.values[this.keys[0]];
      queue.popFront();
      if (!queue.length) {
        this.remove(this.keys[0]);
        return true;
      }
    }
    return false;
  }

  get(key) {
    return this.values[key];
  }

  *[Symbol.iterator]() {
    for (let price of this.keys) {
      for (let order of this.values[price]) {
        yield order;
      }
    }
  }

  next() {
    if (this.keys.length) {
      const price = this.keys[0];
      return { key: price, value: this.values[price], done: false };
    }
    return { key: null, value: null, done: true };
  }
}

class AscSortedMap extends SortedMap {
  constructor() {
    super(new AscSortedArray());
  }
}

class DescSortedMap extends SortedMap {
  constructor() {
    super(new DescSortedArray());
  }
}

module.exports = {
  AscSortedMap,
  DescSortedMap,
};
