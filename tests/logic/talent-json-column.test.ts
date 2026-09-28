import { describe, expect, it } from 'vitest';

import { json } from '../../server/providers/hr/platform.ts';

// JSON columns may arrive encoded, encoded twice, or already decoded by the query adapter.
describe('json column reader', () => {
  it('decodes a string value, such as a single-choice answer, in every form', () => {
    expect(json(JSON.stringify('C'), '')).toBe('C');
    expect(json(JSON.stringify(JSON.stringify('C')), '')).toBe('C');
    expect(json('C', '')).toBe('C');
  });

  it('decodes arrays and objects, and falls back only for missing values', () => {
    expect(json(JSON.stringify(['A', 'B']), [])).toEqual(['A', 'B']);
    expect(json(['A'], [])).toEqual(['A']);
    expect(json(JSON.stringify({ a: 1 }), {})).toEqual({ a: 1 });
    expect(json(null, ['x'])).toEqual(['x']);
    expect(json(undefined, 0)).toBe(0);
  });
});
