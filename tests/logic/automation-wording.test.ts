// @vitest-environment node

// The AI 员工任务 settings page reads `aiAutomations.tasks.<key>.title` and `.description` for every task the server
// registers; the key is built at runtime, so a task without wording shows its key path instead of a name.
import { describe, expect, it } from 'vitest';

import enUS from '../../client/locales/en-US.ts';
import zhCN from '../../client/locales/zh-CN.ts';
import { AUTOMATIONS } from '../../server/providers/hr/automation.ts';

describe('AI automation task wording', () => {
  for (const [locale, resource] of [
    ['en-US', enUS],
    ['zh-CN', zhCN],
  ] as const) {
    it(`every registered task and its AI employee has wording in ${locale}`, () => {
      const tasks = (
        resource as unknown as {
          aiAutomations: {
            employees: Record<string, string>;
            tasks: Record<string, { title?: string; description?: string }>;
          };
        }
      ).aiAutomations.tasks;
      const employees = (
        resource as unknown as {
          aiAutomations: { employees: Record<string, string> };
        }
      ).aiAutomations.employees;
      expect(
        [...new Set(AUTOMATIONS.map((task) => task.employee))].filter(
          (employee) => !employees[employee],
        ),
      ).toEqual([]);
      const missing = AUTOMATIONS.filter(
        (task) => !tasks[task.key]?.title || !tasks[task.key]?.description,
      ).map((task) => task.key);
      expect(missing).toEqual([]);
    });
  }
});
