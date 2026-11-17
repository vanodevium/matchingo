const MAX_SCALE = 15;

export function checkScale(name, scale) {
	if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
		throw new Error(`${name} must be an integer from 0 to ${MAX_SCALE}`);
	}
}

/**
 * Parse a decimal (number or string) into an integer with the given scale.
 * Throws when the value has more digits than the scale.
 * @param {number|string} value
 * @param {number} scale
 * @returns {number}
 */
export function toInt(value, scale) {
	if (typeof value === "number" && value >= 0) {
		// fast path: the number is the closest double of a decimal with this scale
		const factor = 10 ** scale;
		const int = Math.round(value * factor);
		if (int / factor === value && Number.isSafeInteger(int)) {
			return int;
		}
	}

	let text = typeof value === "number" ? String(value) : String(value).trim();

	if (typeof value === "number" && /e/i.test(text) && Number.isFinite(value)) {
		text = value.toFixed(scale);
		if (Number(text) !== value) {
			throw new Error(`invalid decimal for scale ${scale}: ${value}`);
		}
	}

	const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
	if (!match) {
		throw new Error(`invalid decimal: ${value}`);
	}

	const fraction = (match[2] || "").replace(/0+$/, "");
	if (fraction.length > scale) {
		throw new Error(
			`too many digits after the point for scale ${scale}: ${value}`,
		);
	}

	const int = Number(match[1] + fraction.padEnd(scale, "0"));
	if (!Number.isSafeInteger(int)) {
		throw new Error(`decimal is too big: ${value}`);
	}

	return int;
}

/**
 * @param {number} int
 * @param {number} scale
 * @returns {number}
 */
export function fromInt(int, scale) {
	return scale === 0 ? int : int / 10 ** scale;
}

/**
 * Quote value of a base amount, rounded up. The divisor is 10 ** amountScale.
 * @param {number} base
 * @param {number} price
 * @param {number} divisor
 * @returns {number}
 */
export function quoteOf(base, price, divisor) {
	return divisor === 1 ? base * price : Math.ceil((base * price) / divisor);
}

/**
 * Base amount that a quote amount buys at a price, rounded down.
 * @param {number} quote
 * @param {number} price
 * @param {number} divisor
 * @returns {number}
 */
export function baseOf(quote, price, divisor) {
	const numerator = quote * divisor;
	let base = Math.floor(numerator / price);
	if (base * price > numerator) {
		base--;
	}
	return base;
}
