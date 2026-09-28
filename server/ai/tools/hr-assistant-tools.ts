import { defineTools } from '@nocobase/ai-employee';
import { z } from 'zod';

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
