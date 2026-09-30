import { defineTools, type AIEmployeeOptions } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  orgSyncServiceToken,
  positionAliasServiceToken,
} from '../../providers/hr/tokens.js';

/**
 * V1-03 人事助理 · 同步问题说明 in conversations (the 组织同步 page's
 * 问人事助理): reading the pending items, searching positions, drafting
 * job-title mappings and saving notes on items. Every tool acts as the
 * signed-in user with that user's own authorization; a mapping is only ever
 * a draft (createPositionAliasDrafts asks for the user's approval first), and
 * no tool handles an item, raises a personnel action or changes an employee.
 * The unattended explanation after a sync is `hr-assistant-sync.ts`.
 */
const I18N = { namespace: 'hr' };

const failure = (error: unknown) => {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
};

async function actorOf(ctx: {
  actor: { id: string | number };
  deps: { authz: Parameters<typeof scopeForUser>[0] };
}) {
  const userId = String(ctx.actor.id);
  return { userId, authz: await scopeForUser(ctx.deps.authz, userId) };
}

export const listSyncIssues = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List sync issues',
    about:
      'The pending items of an organization sync, with the records they refer to.',
  },
  definition: {
    name: 'listSyncIssues',
    description:
      'Return the pending items (open and in progress) of the latest organization sync, or of the given run: each with its key, type, both sides of the difference, the matched employee, department and position by name, existing mappings with a similar job title, and any explanation already saved. Mobile numbers and email addresses are masked. Read-only.',
    schema: z.object({
      syncRunId: z
        .string()
        .optional()
        .describe('A sync run id; omit for the current items.'),
      unexplainedOnly: z
        .boolean()
        .optional()
        .describe('Only items without a saved explanation.'),
    }),
  },
  dependencies: { sync: orgSyncServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: { syncRunId?: string; unexplainedOnly?: boolean },
  ) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.sync.assistantIssues(await actorOf(ctx), args),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const searchPositions = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Search positions',
    about:
      'Enabled positions with their job family, grade, responsibilities and mappings.',
  },
  definition: {
    name: 'searchPositions',
    description:
      'Search enabled positions by a keyword (title, code or responsibilities), optionally within one job family. Returns each position with its id, job family, grade, responsibilities and the office-suite job titles already mapped to it. Call it before drafting a mapping.',
    schema: z.object({
      keyword: z.string().max(100).optional(),
      jobFamilyId: z.string().max(64).optional(),
    }),
  },
  dependencies: {
    aliases: positionAliasServiceToken,
    authz: authorizationToken,
  },
  invoke: async (ctx, args: { keyword?: string; jobFamilyId?: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.aliases.searchPositions(
          await actorOf(ctx),
          args,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const createPositionAliasDrafts = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  // In a conversation the user approves the call before any draft is written.
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Draft job-title mappings',
    about:
      'Creates draft mappings from office-suite job titles to positions; an HR administrator confirms them.',
  },
  definition: {
    name: 'createPositionAliasDrafts',
    description:
      'Create draft job-title mappings (source ai, status draft) from office-suite job titles to enabled positions, each with the reason (same meaning, same job family, matching responsibilities). A title that already has a mapping in any status is skipped and listed. Drafts change no employee and fill no form until an HR administrator confirms them on the Job-title mappings tab.',
    schema: z.object({
      drafts: z
        .array(
          z.object({
            provider: z.enum(['feishu', 'dingtalk', 'wecom']),
            externalTitle: z.string().min(1).max(200),
            positionId: z.string().min(1).max(64),
            draftReason: z.string().min(1).max(1000),
          }),
        )
        .min(1)
        .max(50),
    }),
  },
  dependencies: {
    aliases: positionAliasServiceToken,
    authz: authorizationToken,
  },
  invoke: async (
    ctx,
    args: {
      drafts: {
        provider: string;
        externalTitle: string;
        positionId: string;
        draftReason: string;
      }[];
    },
  ) => {
    try {
      const result = await ctx.deps.aliases.createDraftsAs(
        await actorOf(ctx),
        args.drafts,
      );
      return {
        status: 'success',
        content: {
          created: result.created.length,
          skipped: result.skipped,
          link: '/settings/org-sync/aliases',
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveSyncIssueNotes = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Save notes on sync items',
    about:
      'Writes an explanation and a suggested action on pending sync items; changes nothing else.',
  },
  definition: {
    name: 'saveSyncIssueNotes',
    description:
      'Save the explanation and the suggested action on pending sync items, by item key. Does not change their status and handles nothing.',
    schema: z.object({
      notes: z
        .array(
          z.object({
            key: z.string().min(1),
            aiExplanation: z.string().min(1).max(1000),
            aiSuggestedAction: z.string().max(300),
          }),
        )
        .min(1)
        .max(100),
    }),
  },
  dependencies: { sync: orgSyncServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      notes: {
        key: string;
        aiExplanation: string;
        aiSuggestedAction: string;
      }[];
    },
  ) => {
    try {
      return {
        status: 'success',
        content: {
          saved: await ctx.deps.sync.saveNotesAs(
            await actorOf(ctx),
            args.notes,
          ),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const SYNC_TOOLS = [
  listSyncIssues,
  searchPositions,
  createPositionAliasDrafts,
  saveSyncIssueNotes,
];

const SYNC_PROMPT = `

组织同步的待处理项（第三步，“组织同步”页的“问人事助理”）：
1. 先调用 listSyncIssues；只根据它返回的数据说明原因，逐条写清“哪里不一致、为什么同步没有处理、建议 HR 做什么”，建议对应页面上已有的处理按钮（生成入职单草稿、发起调岗单 / 晋升单 / 离职单、采用办公软件的上级、新增或确认职务映射、按新映射重新处理、指定对应部门或绑定关系、开通账号、忽略）。对话中带有选中的待处理项时，先说这一项。
2. 数据主源为 NocoHR 时，建议发起哪种异动单要说明依据（部门或岗位变化、同一序列里职级是否更高）；是否发起、何时生效由 HR 决定。
3. 起草职务映射前先调用 searchPositions，只映射到职责明显一致的已有岗位，并在 draftReason 中写明依据（名称同义、同一序列、职责说明一致）；没有合适岗位时不起草，建议 HR 先新建岗位。起草用 createPositionAliasDrafts，需要用户批准后才执行，草稿须 HR 在“职务映射”中确认后才参与同步。
4. 不猜测人员身份：duplicateMatch 只列出候选和差异，不替 HR 判断是哪一个人。
5. 说明中不出现完整的手机号、证件号；不讨论员工的薪资、合同内容。
6. 你不处理待处理项、不发起或提交异动单、不修改员工和部门数据、不确认映射。用户让你“直接把某人改成某岗位”时，说明你不修改员工数据，并给出入口：在“组织同步 / 待处理”中该项的“发起调岗单”，或“人事 / 人事异动”新建调岗单。
7. 用户要求把说明写到待处理项上时，用 saveSyncIssueNotes 保存；它不改变状态。`;

/** Adds the sync tools and prompt points to the HR assistant, like the payroll extension. */
export function withSyncTools(employee: AIEmployeeOptions): AIEmployeeOptions {
  const names = new Set((employee.tools ?? []).map((t) => t.name));
  const extra = [
    { name: 'listSyncIssues', autoCall: true },
    { name: 'searchPositions', autoCall: true },
    { name: 'createPositionAliasDrafts', autoCall: false },
    { name: 'saveSyncIssueNotes', autoCall: true },
  ].filter((t) => !names.has(t.name));
  return {
    ...employee,
    systemPrompt: `${String(employee.systemPrompt ?? '')}${SYNC_PROMPT}`,
    tools: [...(employee.tools ?? []), ...extra],
  };
}
