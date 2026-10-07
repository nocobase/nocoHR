/**
 * V4-14 行业方案 · 持证上岗: the certification steward's new tools. Every tool
 * runs as the person in the conversation, through the same authorization as
 * the pages: traces and transfer checks return only people in the caller's
 * steward scope. No tool changes a certificate, a permission or a schedule.
 */
import { defineTools, type AIEmployeeOptions } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { HrError, str } from '../../providers/hr/shared.js';
import {
  demoBatchServiceToken,
  licensedServicesToken,
} from '../../providers/hr/tokens.js';

const I18N = { namespace: 'hr' };

async function actorOf(ctx: {
  actor: { id: string | number };
  deps: { authz: Parameters<typeof scopeForUser>[0] };
}) {
  const userId = String(ctx.actor.id);
  return { userId, authz: await scopeForUser(ctx.deps.authz, userId) };
}

function failure(error: unknown) {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
}

const deps = { licensed: licensedServicesToken, authz: authorizationToken };

export const getCertificationGrants = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Permissions a certification grants',
    about:
      'The permission sets assigned to a certification, with the pages and operations they open.',
  },
  definition: {
    name: 'getCertificationGrants',
    description:
      'For a certification id (such as cert-cnc, cert-forklift), return whether the industry pack 持证上岗 is on, and the permission sets assigned to the certification subject with the display names of the pages and business operations each opens. Use only these display names when describing what a certificate allows or what is lost when it expires.',
    schema: z.object({ certificationId: z.string().min(1).max(64) }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { certificationId: string }) => {
    try {
      await actorOf(ctx);
      const enabled = await ctx.deps.licensed.enabled();
      const grants = await ctx.deps.licensed.certificationGrants(
        args.certificationId,
      );
      return {
        status: 'success',
        content: {
          certificationId: args.certificationId,
          // Off, certificates bring no permissions: say so rather than listing the sets.
          industryPackEnabled: enabled,
          permissionSets: (enabled ? grants : []).map((grant) => ({
            title: grant.title,
            pages: grant.pages.map((p) => p.title),
            operations: grant.operations.map((o) => o.title),
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const listCertificatesNotRequired = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Certificates no longer required after a job change',
    about:
      'For a transfer or promotion event, the certificates the new position no longer requires that still bring permissions.',
  },
  definition: {
    name: 'listCertificatesNotRequired',
    description:
      'Only in the 调岗资质检查 event task: for a job event id, return the employee, the old and new positions, and each valid or expiring certificate the old position required and the new one does not while it still brings permission sets (with their display names, the operations they open and a link). null when there is nothing to report.',
    schema: z.object({ jobEventId: z.string().min(1).max(64) }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { jobEventId: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.licensed.certificatesNotRequired(
          await actorOf(ctx),
          args.jobEventId,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const traceStartLogs = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Trace start-up and dispatch registrations',
    about:
      'Who registered on a work order operation or a dispatch note, holding which certificate, then and now.',
  },
  definition: {
    name: 'traceStartLogs',
    description:
      'For a work order number (such as MO-24031) or a dispatch note number (CK-24031), optionally an operation number (10, 20, 30 or op20) and a kind (machineStart or forkliftDispatch), list each registration ordered by time: registrant, time, certificate number and its status at registration, its status and expiry now, and when the registrant completed the certification’s required courses, with links to the records. Only people in the current user data range are returned.',
    schema: z.object({
      workOrderNo: z.string().min(1).max(32),
      operationNo: z.string().max(32).optional(),
      kind: z.enum(['machineStart', 'forkliftDispatch']).optional(),
    }),
  },
  dependencies: { demoBatch: demoBatchServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: { workOrderNo: string; operationNo?: string; kind?: string },
  ) => {
    try {
      return {
        status: 'success',
        content: {
          logs: await ctx.deps.demoBatch.traceSignoffs(
            await actorOf(ctx),
            args.workOrderNo,
            args.operationNo,
            args.kind,
          ),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const sendTransferCheckNotice = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Send the qualification check after a job change',
    about:
      'Tells HR and the new department head which certificates still bring permissions; once per event.',
  },
  definition: {
    name: 'sendTransferCheckNotice',
    description:
      'Only in the 调岗资质检查 event task: send the notice for a job event to the task owner and the new department head (their user ids), with a certificate detail link. Only those recipients are accepted and each event is sent once. The content names people, certificates and operations only: no certificate numbers or personal data.',
    schema: z.object({
      jobEventId: z.string().min(1).max(64),
      recipientUserIds: z.array(z.string().min(1).max(64)).min(1).max(5),
      content: z.string().min(1).max(400),
    }),
  },
  dependencies: deps,
  invoke: async (
    ctx,
    args: { jobEventId: string; recipientUserIds: string[]; content: string },
  ) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.licensed.sendTransferCheckNotice(
          await actorOf(ctx),
          args,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const LICENSED_TOOLS = [
  getCertificationGrants,
  listCertificatesNotRequired,
  traceStartLogs,
  sendTransferCheckNotice,
];

/** 认证管家 (V4-14 扩展): what certificates allow, the transfer check and start log traces. */
export function withLicensedStewardTools(
  employee: AIEmployeeOptions,
): AIEmployeeOptions {
  const names = new Set((employee.tools ?? []).map((t) => t.name));
  const tools = [
    { name: 'getCertificationGrants', autoCall: true },
    { name: 'listCertificatesNotRequired', autoCall: true },
    { name: 'traceStartLogs', autoCall: true },
    { name: 'sendTransferCheckNotice', autoCall: false },
  ];
  return {
    ...employee,
    systemPrompt: `${str(employee.systemPrompt ?? '')}

行业方案 · 持证上岗（第十四步）：
1. 说明某张证书能做什么、到期后会失去什么时，先调用 getCertificationGrants，只用它返回的显示名称，不猜测权限内容；它返回空时说明该证书不带来系统操作。
2. 调岗资质检查只陈述事实：员工仍持有哪张证书、仍能使用哪些操作、新岗位是否要求；建议由 HR 决定保留或吊销，不替 HR 决定。listCertificatesNotRequired 与 sendTransferCheckNotice 只在事件任务中使用。
3. 被问到某张业务单据（如工单 MO-24031、出库单 CK-24031）的某个步骤由谁登记、登记当日证书是否有效时，调用 traceStartLogs（优先于只查开工登记的 traceBatchSignoffs），只根据它返回的数据回答，按登记时间排序；逐条写登记人、登记时间、登记时的证书编号与状态、证书现在的状态和必修课程完成时间，并附上记录链接；登记当日有效、现已失效的，写明“登记当日有效，现已过期”（或“现已吊销”）。
4. 不替用户开通权限、续发或吊销证书、放行排班。用户提出时说明应走的流程：开通操作需先取得对应证书（完成课程与考试，外部证书由 HR 核验）；续证请完成复审；吊销由 HR 在认证项目页按吊销流程处理；权限集分配在“设置 → 授权”中由管理员调整；被阻止的排班只能换人或等证书有效后再排。
5. 普通员工只能问自己的证书及其带来的操作；问别人的证书时说明没有权限。`,
    tools: [
      ...(employee.tools ?? []),
      ...tools.filter((t) => !names.has(t.name)),
    ],
  };
}
