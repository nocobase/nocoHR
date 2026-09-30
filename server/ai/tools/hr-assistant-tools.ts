import { defineTools } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { HrError } from '../../providers/hr/shared.js';
import { hrCoreServiceToken } from '../../providers/hr/tokens.js';

const I18N = { namespace: 'hr' };

/**
 * The HR assistant's tools. Both belong to its proactive work only: the
 * health check runs unattended as the task owner and reads the same
 * server-side result (`computeImportIssues`) directly, and the report is sent
 * by the task. Called from a conversation — by anyone, including an HR
 * administrator — they refuse, as V1 step 1 requires ("只能在任务中以持有
 * hr.admin 的负责人身份调用").
 */
const TASK_ONLY = {
  status: 'error' as const,
  content: { code: 'HR_ASSISTANT_TASK_ONLY', details: null },
};

export const listImportIssues = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List import issues',
    about:
      'The problems one employee import left in the data, computed by the server.',
  },
  definition: {
    name: 'listImportIssues',
    description:
      'Return the summary and the issue list of one employee import batch (duplicates, manager loops, departments without a head, missing managers or positions, similar position titles). Only available inside the import health-check task.',
    schema: z.object({
      importBatchId: z.string().describe('The import batch number.'),
    }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});

export const sendHrDigest = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Send an HR digest',
    about: 'Sends an in-app message with quick links; used by tasks only.',
  },
  definition: {
    name: 'sendHrDigest',
    description:
      'Send an in-app message to HR with a title, a body and quick links. Only available inside the HR assistant tasks.',
    schema: z.object({
      recipients: z.array(z.string()),
      title: z.string(),
      body: z.string(),
      links: z.array(z.string()).optional(),
    }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});

/**
 * V1 step 2: the employee's own record, contracts, probation and job history.
 * It takes no employee id — only the signed-in user's own data is ever read —
 * so a question about someone else has nothing to answer from.
 */
export const getMyHrProfile = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read my HR record',
    about:
      "The signed-in employee's own record, contracts, probation and job history.",
  },
  definition: {
    name: 'getMyHrProfile',
    description:
      "Return the signed-in user's own HR record: department, position, status (probation / active / leave), hire date, probation end date, regularization date, contracts with their dates and status, and job history. Takes no arguments and never returns anyone else's data. Call it for every question about the user's own record, contract or probation.",
    schema: z.object({}),
  },
  dependencies: { core: hrCoreServiceToken, authz: authorizationToken },
  invoke: async (ctx) => {
    try {
      const userId = String(ctx.actor.id);
      return {
        status: 'success',
        content: await ctx.deps.core.myHrProfile(
          { userId, authz: await scopeForUser(ctx.deps.authz, userId) },
          'zh-CN',
        ),
      };
    } catch (error) {
      if (error instanceof HrError)
        return {
          status: 'error' as const,
          content: { code: error.code, details: null },
        };
      throw error;
    }
  },
});

/** Probation and renewal summaries are prepared by the daily tasks, as each recipient; never from a conversation. */
export const getEmployeeHrSummary = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Summarize an employee for review',
    about: 'Used by the probation and renewal preparation tasks only.',
  },
  definition: {
    name: 'getEmployeeHrSummary',
    description:
      'Return the facts a probation or contract renewal review needs for one employee. Only available inside the HR assistant tasks.',
    schema: z.object({ employeeId: z.string() }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});

/** Attachments are read by the recognition task as its owner; no conversation reads identity documents. */
export const readAttachment = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read an attachment',
    about: 'Used by the attachment recognition task only.',
  },
  definition: {
    name: 'readAttachment',
    description:
      'Return the content of an employee attachment for recognition. Only available inside the attachment recognition task.',
    schema: z.object({ fileId: z.string() }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});

export const createProfileSuggestion = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Suggest profile changes',
    about:
      'Creates a pending change request for HR to review; used by the recognition task only.',
  },
  definition: {
    name: 'createProfileSuggestion',
    description:
      'Create a pending profile change request (source ai) from what an attachment shows. Never edits the record. Only available inside the attachment recognition task.',
    schema: z.object({
      employeeId: z.string(),
      attachmentFileId: z.string(),
      changes: z.record(z.string(), z.unknown()),
    }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});
