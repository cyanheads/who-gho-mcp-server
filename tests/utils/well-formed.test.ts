/**
 * @fileoverview Tests for the echo-boundary string repair.
 * @module tests/utils/well-formed.test
 */

import { describe, expect, it } from 'vitest';
import { wellFormed } from '@/utils/well-formed.js';

describe('wellFormed', () => {
  it('replaces an unpaired high surrogate with U+FFFD', () => {
    expect(wellFormed('malaria\uD800')).toBe('malaria�');
  });

  it('replaces an unpaired low surrogate with U+FFFD', () => {
    expect(wellFormed('\uDC00malaria')).toBe('�malaria');
  });

  it('leaves a paired astral character untouched', () => {
    expect(wellFormed('\u{1F600}')).toBe('\u{1F600}');
    expect(wellFormed('a\u{1F600}b')).toBe('a\u{1F600}b');
  });

  it('leaves an already well-formed string byte-identical', () => {
    // Whitespace, case, and compatibility forms are all preserved: the repair is a
    // surrogate substitution, not a normalization pass.
    for (const value of ['  WHOSIS_000001  ', 'Ärger', 'ﬁne', 'life expectancy', '']) {
      expect(wellFormed(value)).toBe(value);
    }
  });

  it('repairs only the unpaired half of a mixed string', () => {
    expect(wellFormed(`\u{1F600}\uD800\u{1F600}`)).toBe(`\u{1F600}�\u{1F600}`);
  });
});
