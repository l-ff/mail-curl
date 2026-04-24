import crypto from "crypto";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

function assertLength(length) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new TypeError("length must be a positive integer");
  }
}

function assertIntegerRange(min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new TypeError("min and max must be integers");
  }

  if (min > max) {
    throw new RangeError("min must be less than or equal to max");
  }
}

function randomFromCharset(length, charset) {
  assertLength(length);

  const bytes = crypto.randomBytes(length);
  let output = "";

  for (let i = 0; i < length; i += 1) {
    output += charset[bytes[i] % charset.length];
  }

  return output;
}

export class RandomUtils {
  static letters(length) {
    return randomFromCharset(length, LETTERS);
  }

  static digits(length) {
    return randomFromCharset(length, DIGITS);
  }

  static intBetween(min, max) {
    assertIntegerRange(min, max);
    return crypto.randomInt(min, max + 1);
  }
}
