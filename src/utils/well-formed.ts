/**
 * @fileoverview Repair for caller-supplied strings on their way back into a response.
 * @module utils/well-formed
 */

/**
 * Returns `value` with every unpaired UTF-16 surrogate replaced by U+FFFD.
 *
 * A caller may send a string that is legal JavaScript but has no UTF-8 encoding. Echoed
 * back unchanged, `JSON.stringify` emits it as a lone `\udXXX` escape (well-formed
 * stringify, ES2019) and the JSON-RPC frame stops being decodable: `jq` rejects it and
 * Go's `encoding/json` silently substitutes U+FFFD. The repair is a pure surrogate
 * substitution — a correctly paired non-BMP character and any already well-formed string
 * come back byte-identical, with no trimming, case folding, or Unicode normalization.
 *
 * Apply this where a caller string enters output, enrichment, or failure data. Do **not**
 * apply it on the way to the upstream request: `GhoService` refuses an unencodable URL
 * path identifier rather than repairing it, because a repaired identifier would query a
 * different indicator than the caller named.
 */
export function wellFormed(value: string): string {
  return value.toWellFormed();
}
