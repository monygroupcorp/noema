import { describe, expect, it } from 'vitest';
import { coerceQueryValue } from './Card';

// No jsdom/@testing-library/react in this app's toolchain (see Shelf.test.ts) — this covers
// the one piece of Card.tsx's query-param prefill (noema/examples-of-our-own) that is pure:
// a launch link's query string is always text, so a numeric/boolean aditus field needs casting
// back to the type its JSON-Schema property declares before it lands in the form state.

describe('coerceQueryValue — launch-link prefill casts to the field\'s declared type', () => {
  it('casts an integer field', () => {
    expect(coerceQueryValue('81', 'integer')).toBe(81);
  });

  it('casts a number field', () => {
    expect(coerceQueryValue('3.5', 'number')).toBe(3.5);
  });

  it('falls back to the raw string when a numeric field gets an unparseable value', () => {
    expect(coerceQueryValue('not-a-number', 'integer')).toBe('not-a-number');
  });

  it('casts a boolean field', () => {
    expect(coerceQueryValue('true', 'boolean')).toBe(true);
    expect(coerceQueryValue('false', 'boolean')).toBe(false);
  });

  it('falls back to the raw string for an unparseable boolean', () => {
    expect(coerceQueryValue('maybe', 'boolean')).toBe('maybe');
  });

  it('leaves a string field as-is', () => {
    expect(coerceQueryValue('stationthis a portrait', 'string')).toBe('stationthis a portrait');
  });

  it('leaves the value as-is when the field carries no declared type', () => {
    expect(coerceQueryValue('42', undefined)).toBe('42');
  });
});
