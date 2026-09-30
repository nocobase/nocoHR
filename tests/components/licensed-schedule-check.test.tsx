import { describe, expect, it } from 'vitest';

import { checkText } from '../../client/components/talent/attendance/errors';

const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

describe('checkText · certificationMissing (V4-14)', () => {
  it('names the missing certification and the expiry date', () => {
    const text = checkText(
      {
        rule: 'certificationMissing',
        level: 'block',
        message: 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
        params: { certification: 'CNC 岗位上岗证', expiresAt: '2026-10-05' },
      } as never,
      t,
    );
    expect(text).toContain('attendance.checks.format');
    expect(text).toContain(
      'licensed.checks.CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
    );
    expect(text).toContain('CNC 岗位上岗证');
    expect(text).toContain('2026-10-05');
  });

  it('leaves the other rules as they were', () => {
    expect(
      checkText(
        {
          rule: 'leaveConflict',
          level: 'block',
          message: 'LEAVE_CONFLICT',
        } as never,
        t,
      ),
    ).not.toContain('licensed.');
  });
});
