// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { routeKeyFromText } from '../../server/providers/hr/ai-entry-service.ts';

const keys = ['certificates', 'myRecord', 'policy', 'other'];

describe('routing answers given as text', () => {
  it('reads the replies DeepSeek gave instead of the structured format', () => {
    expect(routeKeyFromText('myRecord', keys)).toEqual({ key: 'myRecord' });
    expect(routeKeyFromText('{"key":"myRecord"}', keys)).toEqual({
      key: 'myRecord',
    });
    expect(
      routeKeyFromText('Returning structured response: {"key":"policy"}', keys),
    ).toEqual({ key: 'policy' });
    expect(routeKeyFromText('应归到 myRecord 这一行。', keys)).toEqual({
      key: 'myRecord',
    });
  });

  it('gives no answer for a key outside the table or for several keys', () => {
    // A key the table does not have, as one reply did.
    expect(
      routeKeyFromText(
        'Returning structured response: {"key":"category"}',
        keys,
      ),
    ).toBeUndefined();
    expect(routeKeyFromText('myRecord 或 policy', keys)).toBeUndefined();
    expect(routeKeyFromText('我不确定', keys)).toBeUndefined();
  });
});
