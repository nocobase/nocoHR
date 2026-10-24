// @vitest-environment node
import type { Application } from '@nocobase/app-server/application';
import { mailServiceToken as nativeMailToken } from '@nocobase/app-plugin-mail/server';
import { describe, expect, it } from 'vitest';
import { observeMailClose } from '../helpers/mail-close-diagnostics.ts';

function fixture() {
  const events: Record<string, unknown>[] = [];
  const native = {
    startSync: () =>
      Promise.resolve({ id: 'run', accountId: 'account', status: 'running' }),
    listSyncRuns: () =>
      Promise.resolve([
        {
          id: 'run',
          accountId: 'account',
          status: 'completed',
          secret: 'never-log',
        },
      ]),
  };
  const business = { poll: () => Promise.resolve({ hr: 0 }) };
  const application = {
    container: {
      resolve: (token: unknown) =>
        token === nativeMailToken ? native : business,
    },
  } as unknown as Application;
  const observer = observeMailClose(
    application,
    'mail-observer-test',
    (line) => {
      events.push(JSON.parse(line.slice('MAIL_CLOSE '.length)));
    },
  );
  return { native, business, application, observer, events };
}

describe('mail close observer', () => {
  it('preserves the original promise and receiver and removes only its wrappers', async () => {
    const f = fixture();
    f.observer.restore();
    let release!: (result: { hr: number }) => void;
    const result = new Promise<{ hr: number }>((resolve) => {
      release = resolve;
    });
    const original = function (this: unknown) {
      expect(this).toBe(f.business);
      return result;
    };
    f.business.poll = original;
    const observer = observeMailClose(
      f.application,
      'mail-observer-test',
      () => {},
    );
    try {
      const actual = f.business.poll();
      expect(actual).toBe(result);
      expect(observer.snapshot().mailPending).toEqual([
        expect.objectContaining({ stage: 'poll' }),
      ]);
      release({ hr: 0 });
      await actual;
      expect(observer.snapshot().mailPending).toEqual([]);
    } finally {
      observer.restore();
    }
    expect(f.business.poll).toBe(original);
  });

  it('preserves synchronous throws and original asynchronous rejections', async () => {
    const f = fixture();
    f.observer.restore();
    const error = new Error('controlled mail failure');
    f.business.poll = () => {
      throw error;
    };
    const rejected = Promise.reject(error);
    f.native.startSync = () => rejected;
    const events: string[] = [];
    const observer = observeMailClose(
      f.application,
      'mail-observer-test',
      (line) => {
        events.push(line);
      },
    );
    try {
      expect(() => f.business.poll()).toThrow(error);
      const actual = f.native.startSync();
      expect(actual).toBe(rejected);
      await expect(actual).rejects.toBe(error);
      expect(observer.snapshot().mailPending).toEqual([]);
      expect(events.filter((line) => line.includes('.failed'))).toHaveLength(2);
    } finally {
      observer.restore();
    }
  });

  it('correlates run IDs and terminal status without recording message or credential fields', async () => {
    const f = fixture();
    try {
      await f.native.startSync();
      expect(f.observer.snapshot().mailRuns).toEqual([
        { id: 'run', accountId: 'account', status: 'running' },
      ]);
      await f.native.listSyncRuns();
      expect(f.observer.snapshot()).toMatchObject({
        mailReads: 1,
        mailRuns: [{ id: 'run', accountId: 'account', status: 'completed' }],
        mailPending: [],
      });
      expect(
        f.events.filter((event) => event.event === 'sync.state'),
      ).toHaveLength(2);
      expect(JSON.stringify(f.events)).not.toContain('never-log');
      expect(JSON.stringify(f.observer.snapshot())).not.toContain('secret');
    } finally {
      f.observer.restore();
    }
  });
});
