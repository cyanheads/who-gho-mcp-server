/**
 * @fileoverview Single-pass decoding of character references in WHO indicator names.
 * @module services/gho/decode-indicator-name
 */

/** Decode supported references once; unknown and invalid references remain literal. */
export function decodeIndicatorName(value: string): string {
  return value.replace(
    /&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|amp|lt|gt|quot|apos);/g,
    (reference: string, body: string) => {
      switch (body) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
      }
      const hex = body[1] === 'x' || body[1] === 'X';
      const point = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : reference;
    },
  );
}
