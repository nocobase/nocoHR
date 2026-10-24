import { expect, it } from 'vitest';

import { capabilityRecordDigest as digest } from '../../server/providers/upgrade/digest.js';

it('compares database values without losing dates, bigint precision or type distinctions', () => {
  expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
  expect(digest(new Date('2026-01-01'))).not.toBe(digest({}));
  expect(digest(9007199254740993n)).not.toBe(digest(9007199254740992n));
  expect(digest(1n)).not.toBe(digest('1'));
  expect(digest(['bigint', '1'])).not.toBe(digest(1n));
});

it('refuses unsupported and cyclic data with a fixed diagnostic', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const value of [cyclic, () => 'secret', new Map(), NaN])
    expect(() => digest(value)).toThrow('UNSUPPORTED_CAPABILITY_RECORD');
});
