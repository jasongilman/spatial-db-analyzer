/**
 * Indexed access helpers.
 *
 * `noUncheckedIndexedAccess` makes every `array[i]` return `T | undefined`,
 * which is the right default but noisy in the tight loops the maps run. These
 * helpers do the check once, in one place, so no call site needs a non-null
 * assertion or a cast that quietly lies about the type.
 */

/**
 * Read an element that must exist.
 *
 * @param array - The array to read.
 * @param index - The index to read.
 * @returns The element.
 * @throws If the index is out of range.
 */
export function requireAt<T>(array: readonly T[], index: number): T {
  const value = array[index];
  if (value === undefined) {
    throw new RangeError(`index ${String(index)} is out of range (length ${String(array.length)})`);
  }
  return value;
}

/**
 * Read a number from a typed array, returning NaN when the index is out of range.
 *
 * NaN is already the sentinel the point renderer uses for "do not draw this
 * one", so an out-of-range read degrades into a skipped mark rather than a
 * crash mid-frame.
 *
 * @param array - The typed array to read.
 * @param index - The index to read.
 * @returns The value, or NaN.
 */
export function numberAt(array: Float64Array, index: number): number {
  return array[index] ?? Number.NaN;
}

/**
 * Read a class code from a typed array.
 *
 * @param array - The typed array to read.
 * @param index - The index to read.
 * @returns The value, or -1 when the index is out of range.
 */
export function codeAt(array: Uint8Array, index: number): number {
  return array[index] ?? -1;
}
