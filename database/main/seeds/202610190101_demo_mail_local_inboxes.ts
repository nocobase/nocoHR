import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * 业务邮件改用 Mail 插件 (2026-10-05), development and demo only (skipped with
 * NODE_ENV=production or HR_DEMO_SEED=false): the demo messages the earlier
 * seeds wrote for the old mock mailboxes (`storage/mail/inbox/<purpose>/`,
 * including what was already read into `processed/`) are copied into the
 * 本地文件邮箱 of each purpose's address
 * (`storage/mail/local/<address>/inbox/`), which the Mail plugin reads. A
 * message already there is left alone, so running again copies nothing twice.
 */
const ADDRESSES: Record<string, string> = {
  billing: 'billing@qiheng.test',
  recruiting: 'recruiting@qiheng.test',
  audit: 'audit@qiheng.test',
  hr: 'hr@qiheng.test',
};

const seed: SeedDefinition = defineSeed({
  name: '202610190101_demo_mail_local_inboxes',
  async run() {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    try {
      const storage = path.resolve(process.cwd(), 'storage');
      for (const [purpose, address] of Object.entries(ADDRESSES)) {
        const from = path.join(storage, 'mail', 'inbox', purpose);
        const to = path.join(storage, 'mail', 'local', address, 'inbox');
        for (const dir of [from, path.join(from, 'processed')]) {
          if (!existsSync(dir)) continue;
          for (const name of readdirSync(dir)) {
            if (!name.toLowerCase().endsWith('.eml')) continue;
            if (existsSync(path.join(to, name))) continue;
            mkdirSync(to, { recursive: true });
            copyFileSync(path.join(dir, name), path.join(to, name));
          }
        }
      }
    } catch {
      // Without a writable storage directory the mailboxes simply start empty.
    }
  },
});
export default seed;
