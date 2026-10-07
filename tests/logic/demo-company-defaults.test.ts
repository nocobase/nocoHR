// @vitest-environment node

// The 启衡精密 demo company used to be every installation's default: production certificates, separation
// certificates and verification-code mails named it, mail went out as 启衡精密人力资源部 and the business mailboxes
// were @qiheng.test. Production now starts neutral (and must name its own company); the demo keeps its values.
import type { AppRuntimeContext } from '@nocobase/app-server/runtime';
import { afterEach, describe, expect, it } from 'vitest';

import businessMail from '../../server/config/business-mail.ts';
import { isDemoEnvironment } from '../../server/config/demo.ts';
import talent from '../../server/config/talent.ts';
import { MAIL_SETTINGS_DEFAULTS } from '../../server/providers/hr/mail/settings.ts';

const runtime = (env: Record<string, string | undefined>) =>
  ({ env }) as unknown as AppRuntimeContext;

const PRODUCTION = { NODE_ENV: 'production' };
const NO_DEMO = { NODE_ENV: 'development', HR_DEMO_SEED: 'false' };
const DEMO = { NODE_ENV: 'development' };

type Issue = { level: 'error' | 'warning'; path: string; fix?: string };

async function validateTalent(companyName: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const context = {
    error: (path: string, _message: string, options?: { fix?: string }) =>
      issues.push({ level: 'error', path, fix: options?.fix }),
    warning: (path: string, _message: string, options?: { fix?: string }) =>
      issues.push({ level: 'warning', path, fix: options?.fix }),
    isUserProvided: () => false,
  };
  const value = { ...talent(runtime(DEMO)), companyName };
  for (const validate of talent.rules?.validators ?? [])
    await (validate as (v: unknown, c: typeof context) => unknown)(
      value,
      context,
    );
  return issues;
}

const savedNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
});

describe('demo company defaults', () => {
  it('follows the demo seeds’ gate', () => {
    expect(isDemoEnvironment(PRODUCTION)).toBe(false);
    expect(isDemoEnvironment(NO_DEMO)).toBe(false);
    expect(isDemoEnvironment(DEMO)).toBe(true);
    expect(isDemoEnvironment({})).toBe(true);
  });

  it('leaves the company name empty outside the demo', () => {
    expect(talent(runtime(PRODUCTION)).companyName).toBe('');
    expect(talent(runtime(NO_DEMO)).companyName).toBe('');
  });

  it('keeps 启衡精密科技 for the demo', () => {
    expect(talent(runtime(DEMO)).companyName).toBe('启衡精密科技');
  });

  it('refuses an empty company name in production and only warns elsewhere', async () => {
    process.env.NODE_ENV = 'production';
    expect(await validateTalent('')).toEqual([
      expect.objectContaining({ level: 'error', path: 'companyName' }),
    ]);
    expect(await validateTalent('  ')).toHaveLength(1);
    expect(await validateTalent('Acme 有限公司')).toEqual([]);
    process.env.NODE_ENV = 'development';
    expect(await validateTalent('')).toEqual([
      expect.objectContaining({ level: 'warning', path: 'companyName' }),
    ]);
  });

  it('configures no business mailbox address outside the demo', () => {
    for (const env of [PRODUCTION, NO_DEMO]) {
      const config = businessMail(runtime(env));
      expect(Object.values(config).map((mailbox) => mailbox.address)).toEqual([
        '',
        '',
        '',
        '',
      ]);
    }
  });

  it('keeps the demo mailboxes at qiheng.test', () => {
    expect(businessMail(runtime(DEMO))).toEqual({
      billing: { address: 'billing@qiheng.test' },
      recruiting: { address: 'recruiting@qiheng.test' },
      audit: { address: 'audit@qiheng.test' },
      hr: { address: 'hr@qiheng.test' },
    });
  });

  it('signs business mail as a neutral 人力资源部 until settings say otherwise', () => {
    expect(MAIL_SETTINGS_DEFAULTS.senderName).toBe('人力资源部');
    expect(JSON.stringify(MAIL_SETTINGS_DEFAULTS)).not.toMatch(/启衡|qiheng/u);
  });
});
