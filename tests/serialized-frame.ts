/**
 * @fileoverview Assertions about the serialized JSON-RPC frame rather than about a
 * single field. A field-equality assertion passes on broken code whenever the expected
 * value is written with the same defect, so the check that actually distinguishes the
 * two is made against `JSON.stringify` output. Not a test file — the lane include globs
 * are `*.test.ts`.
 * @module tests/serialized-frame
 */

import { expect } from 'vitest';

/** A legal JavaScript string with no UTF-8 encoding. */
export const LONE_SURROGATE = '\uD800';

/** What `String.prototype.toWellFormed()` substitutes for an unpaired surrogate. */
export const REPLACEMENT = '�';

/** A correctly paired non-BMP character — must survive every repair byte-identical. */
export const ASTRAL = '\u{1F600}';

/**
 * Matches a lone-surrogate escape in serialized JSON.
 *
 * `JSON.stringify` is well-formed since ES2019: a correctly paired non-BMP character
 * serializes as the character itself, and only an *unpaired* surrogate is emitted as a
 * `\udXXX` escape. Any match is therefore the defect, never a false positive on an emoji.
 */
export const LONE_SURROGATE_ESCAPE = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/;

/**
 * Asserts the value serializes to a frame a strict JSON reader can decode — the property
 * `jq` and Go's `encoding/json` enforce and a field comparison does not.
 */
export function expectWellFormedFrame(value: unknown, label: string): string {
  const frame = JSON.stringify(value);
  expect(frame, `${label} carries a lone-surrogate escape`).not.toMatch(LONE_SURROGATE_ESCAPE);
  return frame;
}

/** The `{ message, data }` pair of a thrown error, as it reaches the wire. */
export function errorFrame(error: unknown): { message: string | undefined; data: unknown } {
  const err = error as { message?: string; data?: unknown };
  return { message: err.message, data: err.data };
}
