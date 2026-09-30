import { defineTools, type AIEmployeeOptions } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { authorizeAction, scopeForUser } from '../../providers/hr/authorize.js';
import { HrError, str } from '../../providers/hr/shared.js';
import { payrollServicesToken } from '../../providers/hr/tokens.js';

/**
 * V2-06 人事助理 and 派遣对账员 tools. Each runs as the signed-in user (or the
 * task owner) with that user's own authorization:
 *
 * - `getMyPayslip` / `getMySocialInsurance` take no employee: the caller's
 *   own published payslip, only after the payslip page's identity check in the
 *   last 30 minutes (otherwise the answer asks to verify first).
 * - `listPayrollAnomalies` / `savePayrollReview` need the payroll actions;
 *   the review writes notes only, never an amount.
 * - `getVendorBillReconciliation` / `saveVendorBillNotes` are for the
 *   administrator-created 派遣对账员: hours and notes, never amounts, and the
 *   bill is never confirmed or sent.
 */
const I18N = { namespace: 'hr' };

const failure = (error: unknown) => {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: {
        code: error.code,
        details:
          error.code === 'PAYSLIP_VERIFY_REQUIRED'
            ? { link: '/talent/my-payslips' }
            : null,
      },
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

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/u)
  .describe('The payroll month, such as 2026-10.');

export const getMyPayslip = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read my payslip',
    about: "The signed-in employee's own published payslip for a month.",
  },
  definition: {
    name: 'getMyPayslip',
    description:
      "Return the signed-in user's own published payslip for one month: each item with its amount (or value and unit for reference items such as a piece count), the formula and the values it used (e.g. \"12 × 50\"), and the totals (gross, social insurance, housing fund, tax, net). Requires the payslip page's identity check within the last 30 minutes; otherwise answers PAYSLIP_VERIFY_REQUIRED with the page link. Never another employee's.",
    schema: z.object({ month }),
  },
  dependencies: { payroll: payrollServicesToken, authz: authorizationToken },
  invoke: async (ctx, args: { month: string }) => {
    try {
      const slip = await ctx.deps.payroll.mine.get(
        await actorOf(ctx),
        args.month,
      );
      return {
        status: 'success',
        content: {
          month: slip.month,
          items: slip.lines.map((line) => ({
            title: line.title,
            kind: line.kind,
            amount: line.amount,
            value: line.value,
            unit: line.unit,
            formula: line.formula,
            calculation: line.expression,
            sources: line.sources.map((s) => ({
              name: s.name,
              value: s.value,
              source: s.source,
            })),
          })),
          gross: slip.gross,
          socialInsurance: slip.socialEmployee,
          housingFund: slip.housingFundEmployee,
          tax: slip.tax,
          net: slip.net,
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const getMySocialInsurance = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read my social insurance',
    about:
      "The signed-in employee's own insured city, bases and personal contributions.",
  },
  definition: {
    name: 'getMySocialInsurance',
    description:
      "Return the signed-in user's own social insurance and housing fund: insured city, social and housing fund bases, and each personal contribution (base × rate) of the latest published payslip. Requires the payslip page's identity check within the last 30 minutes. Takes nothing.",
    schema: z.object({}),
  },
  dependencies: { payroll: payrollServicesToken, authz: authorizationToken },
  invoke: async (ctx) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.payroll.mine.socialInsurance(
          await actorOf(ctx),
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const listPayrollAnomalies = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List payroll anomalies',
    about:
      "The server's anomaly check of a payroll cycle; for payroll specialists.",
  },
  definition: {
    name: 'listPayrollAnomalies',
    description:
      'List the anomalies the server finds in a payroll cycle: net pay change over the threshold, below the minimum wage, large manual items, imported items missing or far above recent months, prorated days not matching the record, insurance bases outside the plan, overtime without an overtime item, and a formula parameter with different values across structures. Each has a key, a type, the employee and facts (days, percentages, codes, dates; never amounts). Only for holders of the payroll view action.',
    schema: z.object({ cycleId: z.string().min(1).max(64) }),
  },
  dependencies: { payroll: payrollServicesToken, authz: authorizationToken },
  invoke: async (ctx, args: { cycleId: string }) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, 'talent.payroll', 'view');
      const report = await ctx.deps.payroll.anomalies(args.cycleId);
      return {
        status: 'success',
        content: {
          month: report.month,
          issues: report.issues.map((i) => ({
            key: i.issue.key,
            type: i.issue.type,
            employee: i.name,
            facts: i.issue.facts,
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const savePayrollReview = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Save payroll review notes',
    about: 'Writes a note per anomaly of a payroll cycle; changes no amount.',
  },
  definition: {
    name: 'savePayrollReview',
    description:
      'Write one explanatory note per anomaly (likely cause, what to check, whom to ask) to the anomaly list of a payroll cycle. Keys must come from listPayrollAnomalies. Notes only: amounts, formulas, imports, files and enrolments are never changed.',
    schema: z.object({
      cycleId: z.string().min(1).max(64),
      notes: z
        .array(
          z.object({
            key: z.string().min(1).max(200),
            note: z.string().min(1).max(400),
          }),
        )
        .min(1)
        .max(500),
    }),
  },
  dependencies: { payroll: payrollServicesToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: { cycleId: string; notes: { key: string; note: string }[] },
  ) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, 'talent.payroll', 'calculate');
      const notes = new Map(args.notes.map((n) => [n.key, n.note.trim()]));
      let saved = 0;
      const database = ctx.deps.payroll.context.platform.database;
      for (const slip of await ctx.deps.payroll.cycles.payslipsOf(
        args.cycleId,
      )) {
        if (!slip.issues.some((i) => notes.has(i.key))) continue;
        const issues = slip.issues.map((i) => {
          const note = notes.get(i.key);
          if (!note) return i;
          saved += 1;
          return { ...i, note, noteSource: 'ai' as const };
        });
        await database
          .query()
          .updateTable('payslips')
          .set({ issues, updatedAt: new Date() })
          .where('id', '=', slip.id)
          .execute();
      }
      return { status: 'success', content: { saved } };
    } catch (error) {
      return failure(error);
    }
  },
});

export const getVendorBillReconciliation = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read a vendor bill reconciliation',
    about:
      "The server's hour-by-hour reconciliation of a labour vendor's bill.",
  },
  definition: {
    name: 'getVendorBillReconciliation',
    description:
      "Return the server's reconciliation of a labour vendor's monthly bill against locked attendance: for each person the billed hours, attendance hours, the difference and the reason (notMatched: employee number unknown; notInAttendance: no attendance; diff: hours differ), with totals. Never amounts.",
    schema: z.object({ billId: z.string().min(1).max(64) }),
  },
  dependencies: { payroll: payrollServicesToken, authz: authorizationToken },
  invoke: async (ctx, args: { billId: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.payroll.bills.reconciliationFor(
          await actorOf(ctx),
          args.billId,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveVendorBillNotes = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Save vendor bill notes',
    about:
      'Writes the reconciliation notes of a vendor bill; confirms and sends nothing.',
  },
  definition: {
    name: 'saveVendorBillNotes',
    description:
      "Write the reconciliation notes of a labour vendor's bill (who differs, by how many hours, what to ask the vendor). Sets the bill to reconciled. Does not change the lines or the reconciliation, does not confirm the bill and does not send anything.",
    schema: z.object({
      billId: z.string().min(1).max(64),
      notes: z.string().min(1).max(4000),
    }),
  },
  dependencies: { payroll: payrollServicesToken, authz: authorizationToken },
  invoke: async (ctx, args: { billId: string; notes: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.payroll.bills.saveNotes(
          await actorOf(ctx),
          args.billId,
          args.notes,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const PAYROLL_TOOLS = [
  getMyPayslip,
  getMySocialInsurance,
  listPayrollAnomalies,
  savePayrollReview,
  getVendorBillReconciliation,
  saveVendorBillNotes,
] as const;

/** 人事助理（第六步）: the payroll prompt points and tools, added to the employee defined in hr-assistant/. */
const PAYROLL_PROMPT = `

工资、社保与个税（第六步）：
1. 解释工资条只用 getMyPayslip 返回的数据，说清每一项从哪里来，例如“夜班 12 次 × 50 元”“计件 2,400 件 × 0.50 元”；不评价金额是否合理。getMyPayslip 提示需要验证身份时，请员工先在“我的工资条”页验证身份，再回来问。
2. 不回答其他人的薪资；不透露薪资结构中本人不适用的项目和金额。
3. 员工认为有错时，建议通过“我的档案”向薪酬专员反馈，不承诺更正。
4. 涉及个税政策、社保政策的判断只做一般说明，具体以财务和当地规定为准；本人的参保城市、基数和个人缴费用 getMySocialInsurance。
5. 写异常说明时只陈述数据和可能原因（如“本月事假 5 天”“计件数未导入”），不建议调整金额。
6. 参数取值不一致时，用 searchKnowledge 查找对应的制度条款，写清“哪个结构的哪个参数、与哪份制度的哪一条不一致、这个值可能出自哪份文件（含已被取代的旧版本）”，由薪酬专员决定是否修改结构；导入缺人时说明可能的原因（如当月入职、导入文件中没有该工号），建议向谁核实。
7. 不修改金额、公式、导入值、薪资档案和参保记录，不提交、不审批、不发布。`;

export function withPayrollTools(
  employee: AIEmployeeOptions,
): AIEmployeeOptions {
  const names = new Set((employee.tools ?? []).map((t) => t.name));
  const extra = [
    { name: 'getMyPayslip', autoCall: true },
    { name: 'getMySocialInsurance', autoCall: true },
    { name: 'listPayrollAnomalies', autoCall: true },
    { name: 'savePayrollReview', autoCall: false },
    { name: 'searchKnowledge', autoCall: true },
  ].filter((t) => !names.has(t.name));
  return {
    ...employee,
    systemPrompt: `${str(employee.systemPrompt ?? '')}${PAYROLL_PROMPT}`,
    tools: [...(employee.tools ?? []), ...extra],
  };
}
