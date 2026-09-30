/**
 * Where a sync reads an office suite's directory from (V1-03). The spec asks
 * to use the user data sync plugin and the Feishu / DingTalk / WeCom sign-in
 * plugins; none is installed in this application, so the source is an
 * adapter behind this interface. A real adapter belongs to such a plugin and
 * reads credentials an administrator configured there — never this
 * repository. Until one exists, development runs on `createMockSource`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ORG_PROVIDERS = ['feishu', 'dingtalk', 'wecom'] as const;
export type OrgProvider = (typeof ORG_PROVIDERS)[number];

export interface DirectoryDepartment {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  /** The member id of the department's head, if any. */
  readonly managerUserId: string | null;
}

export interface DirectoryMember {
  readonly userId: string;
  readonly name: string;
  readonly employeeNo: string | null;
  readonly email: string | null;
  readonly mobile: string | null;
  /** The primary department of a member of several. */
  readonly departmentId: string;
  readonly title: string | null;
  readonly managerUserId: string | null;
  /** false once the member is deactivated or has left. */
  readonly active: boolean;
  readonly deactivatedAt: string | null;
}

export interface Directory {
  readonly departments: readonly DirectoryDepartment[];
  readonly members: readonly DirectoryMember[];
}

export interface OrgDirectorySource {
  readonly provider: OrgProvider;
  /** A short description for the connection tab: never a credential. */
  readonly label: string;
  /** Whether credentials (or, for the mock, its file) are in place. */
  configured(): Promise<boolean>;
  fetch(): Promise<Directory>;
}

/**
 * 模拟数据源（仅开发环境）: a local JSON file standing in for a Feishu test
 * tenant — `{ departments: [...], members: [...] }` in the shapes above.
 * Editing the file and syncing again simulates changes in Feishu. It is
 * registered only outside production.
 */
export function createMockSource(
  file: string,
  /** Written to the file when it does not exist yet: the demo directory. */
  initial?: unknown,
): OrgDirectorySource {
  async function ensure(): Promise<boolean> {
    try {
      await readFile(file);
      return true;
    } catch {
      if (!initial) return false;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(initial, null, 2)}\n`);
      return true;
    }
  }
  return {
    provider: 'feishu',
    label: 'mock',
    configured: ensure,
    async fetch() {
      if (!(await ensure())) throw new Error('ORG_SYNC_MOCK_FILE_MISSING');
      const parsed = JSON.parse(await readFile(file, 'utf8')) as {
        departments?: Partial<DirectoryDepartment>[];
        members?: Partial<DirectoryMember>[];
      };
      const text = (value: unknown) =>
        typeof value === 'string' && value.trim() ? value.trim() : null;
      return {
        departments: (parsed.departments ?? []).map((d) => ({
          id: String(d.id),
          name: String(d.name),
          parentId: text(d.parentId),
          managerUserId: text(d.managerUserId),
        })),
        members: (parsed.members ?? []).map((m) => ({
          userId: String(m.userId),
          name: String(m.name),
          employeeNo: text(m.employeeNo),
          email: text(m.email),
          mobile: text(m.mobile),
          departmentId: String(m.departmentId),
          title: text(m.title),
          managerUserId: text(m.managerUserId),
          active: m.active !== false,
          deactivatedAt: text(m.deactivatedAt),
        })),
      };
    },
  };
}
