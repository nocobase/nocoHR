import { defineTools } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { CHAIN_ACTION_TYPES } from '../../providers/hr/personnel-settings.js';
import { DRAFT_ITEM_SCHEMA } from '../../providers/hr/settings-drafts.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  accessExplainerToken,
  hrCoreServiceToken,
  settingsDraftServiceToken,
} from '../../providers/hr/tokens.js';

/**
 * V1-02 人事助理 tools used in conversations:
 *
 * - submitMyProfileChange: the employee's own change request, only after the
 *   employee approved the call in the chat (defaultPermission ASK);
 * - explainAccess: why someone can or cannot see a record, read-only;
 * - previewApprovalChain / draftSettingsChange: 一句话改配置 for HR
 *   administrators — a preview and drafts only; the administrator confirms
 *   each draft on the 人事设置 page.
 *
 * Every tool acts as the signed-in user, with that user's own authorization.
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

export const submitMyProfileChange = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Submit my profile change',
    about:
      "Submits the signed-in employee's own change request after they approve it; HR reviews it.",
  },
  definition: {
    name: 'submitMyProfileChange',
    description:
      "Submit a change request for the signed-in employee's own record, for HR to review. Only the fields 人事设置 · 员工自助 allows: mobile, email, address, emergencyContacts [{name, relation, phone}], educations, experiences, and customFields {key: value} for added fields placed for self-service. List the before and after values to the employee first; the call runs only after they approve it. Never for department, position, status or ID number.",
    schema: z.object({
      changes: z
        .record(z.string(), z.unknown())
        .describe(
          'Field → new value, e.g. {"address": "…", "emergencyContacts": [...]}.',
        ),
    }),
  },
  dependencies: { core: hrCoreServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { changes: Record<string, unknown> }) => {
    try {
      const request = await ctx.deps.core.requestProfileChange(
        await actorOf(ctx),
        args.changes,
        'assistant',
      );
      return {
        status: 'success',
        content: { id: request.id, status: request.status, link: '/talent/me' },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const explainAccess = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Explain access',
    about:
      'Why a user can or cannot see an employee: subjects, permission sets and scope. Read-only.',
  },
  definition: {
    name: 'explainAccess',
    description:
      "Explain why a user can or cannot see an employee record: the subjects the user resolves to (department, department head, position), the permission sets assigned to them, the employee's department and its head, and whether the record (and its sensitive fields) is readable in that user's scope. user defaults to the signed-in user; only HR administrators may ask about someone else. Read-only; never changes permissions.",
    schema: z.object({
      user: z
        .string()
        .optional()
        .describe(
          'The viewer’s name or employee number; omit for the signed-in user.',
        ),
      employee: z
        .string()
        .optional()
        .describe('The employee’s name or employee number.'),
    }),
  },
  dependencies: { explainer: accessExplainerToken, authz: authorizationToken },
  invoke: async (ctx, args: { user?: string; employee?: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.explainer.explain(await actorOf(ctx), args),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const previewApprovalChain = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Preview an approval chain',
    about:
      'The chain an action would get now in a department; HR administrators only.',
  },
  definition: {
    name: 'previewApprovalChain',
    description:
      'Return the approval chain a personnel action of this type would get now for this department id, with merged, auto-passed and fallback levels. HR administrators only. Draft rules are previewed by draftSettingsChange itself.',
    schema: z.object({
      departmentId: z.string(),
      actionType: z.enum(CHAIN_ACTION_TYPES),
    }),
  },
  dependencies: { core: hrCoreServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      departmentId: string;
      actionType: (typeof CHAIN_ACTION_TYPES)[number];
    },
  ) => {
    try {
      const actor = await actorOf(ctx);
      await actor.authz.require({
        resource: { type: 'settings', id: 'talent.hr' },
        action: 'administer',
      });
      return {
        status: 'success',
        content: await ctx.deps.core.previewChain(actor, args),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const draftSettingsChange = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Draft a settings change',
    about:
      'Turns an HR administrator’s sentence into configuration drafts with previews; writes nothing until confirmed.',
  },
  definition: {
    name: 'draftSettingsChange',
    description:
      'Create configuration drafts from what the HR administrator said. Each item is one of: {type:"chainRule", department (name as said), actionTypes (onboard/regularize/transfer/promote/offboard), name (e.g. 分管负责人审批), approver {type:"departmentHead", department?} or {type:"permissionSet", key} — a person named by the unit they head, such as 厂长 / 院长 / 店长 / 区域经理 / 项目负责人, is the head of that unit: {type:"departmentHead", department:"<the unit as named in the organisation, e.g. 成都工厂 or 南京西路店>"}; permissionSet only for a permission set key that exists, position afterFirst (after the department-head level, default) or afterHr}; {type:"customField", label, fieldType (text/textarea/number/date/select/multiSelect/boolean), options (labels, for select), placements (detail/list/filter/import/export/onboardForm/selfService), required, sensitive}; {type:"setting", section (reminders/probation/selfService/jobInfo/checklists/compliance), changes (only the keys that change)}. The server resolves names, runs a preview (the approval chain is tried on a sample action) and stores drafts; nothing takes effect until the administrator confirms each draft on the 人事设置 page. Permission assignments, salaries and other pages cannot be drafted.',
    schema: z.object({
      utterance: z.string().describe('What the administrator said, verbatim.'),
      items: z.array(DRAFT_ITEM_SCHEMA).min(1).max(10),
    }),
  },
  dependencies: {
    drafts: settingsDraftServiceToken,
    authz: authorizationToken,
  },
  invoke: async (ctx, args: { utterance: string; items: unknown[] }) => {
    try {
      const change = await ctx.deps.drafts.draft(
        await actorOf(ctx),
        args.utterance,
        args.items,
      );
      return {
        status: 'success',
        content: {
          id: change.id,
          items: change.items.map((i) => ({
            index: i.index,
            type: i.input.type,
            preview: i.preview,
            warnings: i.warnings,
          })),
          link: '/settings/personnel',
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});
