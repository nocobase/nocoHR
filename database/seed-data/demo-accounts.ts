/**
 * Demo accounts for development and demo seeds. Every demo account shares one
 * password, which never enters the repository: HR_DEMO_PASSWORD when set,
 * otherwise the password recorded in storage/hr-demo-accounts.txt by the first
 * demo seed, otherwise a new random one written there.
 */
import type { SeedDefinition } from '@nocobase/db';
import { hashPassword } from 'better-auth/crypto';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The query builder a seed's `run` receives. */
type SeedQuery = Parameters<SeedDefinition['run']>[0]['query'];

const ACCOUNTS_FILE = () =>
  path.resolve(process.cwd(), 'storage', 'hr-demo-accounts.txt');
const PASSWORD_LINE = /Password for every account: (\S+)/u;

function demoPassword(): { password: string; fromFile: boolean } {
  if (process.env.HR_DEMO_PASSWORD)
    return { password: process.env.HR_DEMO_PASSWORD, fromFile: false };
  const file = ACCOUNTS_FILE();
  if (existsSync(file)) {
    const match = PASSWORD_LINE.exec(readFileSync(file, 'utf8'));
    if (match) return { password: match[1], fromFile: true };
  }
  return {
    password: `Demo-${randomBytes(6).toString('base64url')}`,
    fromFile: false,
  };
}

/** Creates the account when missing and answers its user id. */
export async function ensureDemoAccount(
  query: SeedQuery,
  account: { username: string; name: string; email: string },
): Promise<string> {
  const existing = await query
    .selectFrom('user')
    .select('id')
    .where('username', '=', account.username)
    .executeTakeFirst();
  if (existing) return String(existing.id);
  const { password, fromFile } = demoPassword();
  const now = new Date();
  const userId = randomUUID();
  await query
    .insertInto('user')
    .values({
      id: userId,
      name: account.name,
      username: account.username,
      email: account.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await query
    .insertInto('account')
    .values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  if (!process.env.HR_DEMO_PASSWORD) {
    const file = ACCOUNTS_FILE();
    mkdirSync(path.dirname(file), { recursive: true });
    const line = `${account.username}\t${account.name}\t${account.email}\n`;
    const content = fromFile
      ? readFileSync(file, 'utf8')
      : `# NocoHR demo accounts (development only). Password for every account: ${password}\n`;
    writeFileSync(
      file,
      `${content.endsWith('\n') ? content : `${content}\n`}${line}`,
      { mode: 0o600 },
    );
  }
  return userId;
}
