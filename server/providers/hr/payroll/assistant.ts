/**
 * V2-06 人事助理 · 算薪异常检查, and the 账单上传后处理 run.
 *
 * 算薪异常检查 (`hrAssistant.payrollCheck`): after every calculation (a new
 * calculationId, which is also the dedupe key, so one calculation is checked
 * once), as the task owner (default payroll01): the rules list the issues
 * (`anomalies.ts`); for a parameter that differs between structures, the
 * owner's readable policy documents are searched for the parameter, superseded
 * versions included. The assistant writes one note per issue as structured
 * output — given only types, names, dates, days, percentages, parameter
 * values and document excerpts, never an amount; without a model, rule
 * templates write the notes and the run is marked fallback. The list
 * replaces the previous one as a whole; the owner is told what was added and
 * what disappeared. The run record keeps employee ids and issue types only.
 * The assistant changes no amount, formula, import, file or enrolment.
 *
 * 账单上传后处理 (`vendorReconciler.billReview`): the AI employee chosen in
 * 薪酬设置 (an administrator creates it in the AI employee plugin and binds
 * `getVendorBillReconciliation` and `saveVendorBillNotes`) is run as the task
 * owner with its own tools; without one, only hr.payroll is told. Without a
 * model, a rule-based note is written instead.
 */
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from '../ai-runner.js';
import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type { AutomationService, AutomationRunContext } from '../automation.js';
import { str } from '../shared.js';
import type { AnomalyCheck, AnomalyReport } from './anomalies.js';
import { json } from './common.js';
import type { PayrollContext } from './context.js';
import type { CycleService, PayslipIssue } from './cycles.js';
import type { VendorBillService } from './vendor-bills.js';

export const PAYROLL_CHECK = 'hrAssistant.payrollCheck';
export const BILL_REVIEW = 'vendorReconciler.billReview';

export interface PolicyExcerpt {
  documentId: string;
  title: string;
  docNo: string | null;
  version: string | null;
  current: boolean;
  line: string;
  values: number[];
}

const notesSchema = z.object({
  summary: z.string().max(800),
  notes: z
    .array(z.object({ key: z.string().max(200), note: z.string().max(400) }))
    .max(500),
});

const TYPE_LABEL: Record<string, string> = {
  netChange: '实发较上月变化超过阈值',
  belowMinimumWage: '实发低于当地最低工资标准',
  manualLarge: '手工项目金额超过阈值',
  importMissing: '导入项目缺少本月数值',
  importSpike: '导入值超出近 3 个月正常范围',
  prorationMismatch: '折算天数与档案不一致',
  baseOutOfRange: '社保基数超出方案上下限',
  overtimeNoPay: '有加班小时但没有加班费项目',
  paramMismatch: '公式参数在不同结构间取值不同',
  // V4-12
  perfResultMissing: '设置了考核周期但没有考核结果',
  perfCoefficientsMissing: '考核方案未设置绩效系数',
};

export function createPayrollAssistant(deps: {
  ctx: PayrollContext;
  cycles: CycleService;
  anomalies: AnomalyCheck;
  bills: VendorBillService;
  automation: () => AutomationService;
  ai: AIRunner;
}) {
  const { ctx, cycles, anomalies, bills } = deps;
  const { database } = ctx.platform;

  /** Lines of the owner's readable documents that mention the parameter, with the numbers in them. */
  async function policyExcerpts(
    run: AutomationRunContext,
    title: string,
  ): Promise<PolicyExcerpt[]> {
    const policies = await tryAuthorizeAction(
      run.owner.authz,
      'talent.knowledgeAssistant',
      'use',
    );
    if (!policies?.kbDocuments) return [];
    const rows = (await database
      .repository('kbDocuments')
      .withPolicy(policyOf(policies, 'kbDocuments'))
      .findMany({ filter: { parseStatus: 'ready' } })) as Record<
      string,
      unknown
    >[];
    const keyword = title.replace(/标准$/u, '');
    const excerpts: PolicyExcerpt[] = [];
    for (const row of rows) {
      const text = row.contentText ? str(row.contentText) : '';
      for (const line of text.split('\n')) {
        if (!line.includes(keyword)) continue;
        const values = [...line.matchAll(/(\d+(?:\.\d+)?)\s*元/gu)].map((m) =>
          Number(m[1]),
        );
        if (!values.length) continue;
        excerpts.push({
          documentId: str(row.id),
          title: str(row.title),
          docNo: row.docNo ? str(row.docNo) : null,
          version: row.version ? str(row.version) : null,
          current:
            (row.active === true || row.active === 1) && !row.supersededById,
          line: line.trim().slice(0, 200),
          values,
        });
      }
    }
    return excerpts;
  }

  function docName(d: PolicyExcerpt): string {
    return `《${d.title}》${d.docNo ?? ''}${d.version ? ` ${d.version}` : ''}`.trim();
  }

  /** The rule-based note for an issue: the facts and a likely cause, never an adjustment. */
  function templateNote(
    item: AnomalyReport['issues'][number],
    excerpts: Map<string, PolicyExcerpt[]>,
    affected: Map<string, string[]>,
  ): string {
    const f = item.issue.facts;
    const name = item.name;
    switch (item.issue.type) {
      case 'netChange': {
        const causes: string[] = [];
        if (num(f.personalLeaveDays))
          causes.push(`本月事假 ${num(f.personalLeaveDays)} 天`);
        if (num(f.sickLeaveDays))
          causes.push(`本月病假 ${num(f.sickLeaveDays)} 天`);
        if (num(f.absentDays)) causes.push(`旷工 ${num(f.absentDays)} 天`);
        if (f.partialMonth) causes.push('本月入职或离职，按在职天数折算');
        if (num(f.manualItems))
          causes.push(`有 ${num(f.manualItems)} 条手工项目`);
        return `${name}实发较上月${f.direction === 'down' ? '下降' : '上升'} ${Math.abs(num(f.percent))}%（阈值 ${num(f.threshold)}%）。${
          causes.length
            ? `可能原因：${causes.join('；')}。`
            : '考勤与导入中没有明显原因，请核对薪资档案与手工项目。'
        }无需调整时，建议发布前告知本人。`;
      }
      case 'belowMinimumWage':
        return `${name}实发低于${str(f.city ?? '')}最低工资标准，请核对出勤、扣款与参保基数。`;
      case 'manualLarge':
        return `${name}有一条手工项目超过阈值（原因：${str(f.reason ?? '')}），请复核依据与审批材料。`;
      case 'importMissing': {
        const parts = [
          `${name}适用“${str(f.itemTitle)}”，本周期没有导入数值（按 0 计算）`,
        ];
        if (f.hiredThisMonth && f.hireDate)
          parts.push(`${str(f.hireDate)} 入职`);
        if (f.imported)
          parts.push(
            f.inFile
              ? '导入文件中有该工号但数值为空'
              : `导入文件中没有该工号 ${str(f.employeeNo)}`,
          );
        else parts.push('该项目本周期尚未导入');
        return `${parts.join('；')}。建议向${str(f.department) || '所在部门'}核实后补导入。`;
      }
      case 'importSpike':
        return `${name}的“${str(f.itemTitle)}”为近 ${num(f.months)} 个月平均的 ${num(f.ratio)} 倍（阈值 ${num(f.factor)} 倍），请向报送部门核实数据。`;
      case 'prorationMismatch':
        return `${name}本月计薪天数按 ${num(f.usedDays)} 天计算，按档案（入职 ${str(f.hireDate ?? '—')}，离职 ${str(f.leaveDate ?? '—')}）应为 ${num(f.expectedDays)} 天，请核对档案后重新计算。`;
      case 'baseOutOfRange':
        return `${name}的参保基数${f.below ? '低于' : '高于'}${str(f.city)}方案的${f.below ? '下限' : '上限'}，计算时已按方案截取，请核对参保记录。`;
      case 'overtimeNoPay':
        return `${name}本月有 ${num(f.hours)} 小时加班，但适用结构中没有读取加班小时的项目，请核对薪资结构。`;
      case 'paramMismatch': {
        const param = str(f.param);
        const docs = excerpts.get(param) ?? [];
        const value = num(f.value);
        const reference = num(f.referenceValue);
        const policy = docs.find(
          (d) => d.current && d.values.includes(reference),
        );
        const source = docs.find((d) => d.values.includes(value));
        const people = affected.get(`${param}:${str(f.structureId)}`) ?? [name];
        const parts = [
          `“${str(f.structureTitle)}”的 ${param}（${str(f.paramTitle)}）为 ${value}，“${str(f.referenceStructures)}”为 ${reference}`,
        ];
        if (policy) parts.push(`${docName(policy)}写明“${policy.line}”`);
        if (source)
          parts.push(
            `${value} 可能出自${source.current ? '' : '已被取代的'}${docName(source)}（“${source.line}”）`,
          );
        else if (f.changeLog) parts.push(`结构修改记录：${str(f.changeLog)}`);
        parts.push(
          `受影响的员工：${people.slice(0, 10).join('、')}${people.length > 10 ? ' 等' : ''}`,
        );
        return `${parts.join('；')}。是否修改结构由薪酬专员决定。`;
      }
      // V4-12: the review cycle's name only, never a rating.
      case 'perfResultMissing':
        return `${name}在“${str(f.cycleTitle)}”中没有已发布的考核结果，本月 perf.coefficient 按 0 计算；请向负责 HR 核实。`;
      case 'perfCoefficientsMissing':
        return `${name}所用考核方案没有设置绩效系数，本月 perf.coefficient 按 0 计算；请在薪酬设置 · 绩效系数中维护。`;
      default:
        return `${name}：${TYPE_LABEL[item.issue.type] ?? item.issue.type}。`;
    }
  }

  function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async function payrollCheck(
    run: AutomationRunContext,
    cycleId: string,
    calculationId: string,
  ) {
    await authorizeAction(run.owner.authz, 'talent.payroll', 'view');
    const report = await anomalies(cycleId);
    // A newer calculation replaced this one: its own run checks it.
    if (report.calculationId !== calculationId)
      return { status: 'skipped' as const, output: { reason: 'stale' } };
    const cycle = await cycles.cycleRow(cycleId);
    const before = new Map<string, string>();
    for (const slip of await cycles.payslipsOf(cycleId))
      for (const issue of slip.issues) before.set(issue.key, slip.employeeId);

    const excerpts = new Map<string, PolicyExcerpt[]>();
    const affected = new Map<string, string[]>();
    for (const item of report.issues)
      if (item.issue.type === 'paramMismatch') {
        const param = str(item.issue.facts.param);
        if (!excerpts.has(param))
          excerpts.set(
            param,
            await policyExcerpts(run, str(item.issue.facts.paramTitle)),
          );
        const key = `${param}:${str(item.issue.facts.structureId)}`;
        affected.set(key, [...(affected.get(key) ?? []), item.name]);
      }

    const notes = new Map<string, string>();
    let source: 'ai' | 'rule' = 'ai';
    let summary = '';
    if (report.issues.length) {
      const facts = report.issues.map((item) => ({
        key: item.issue.key,
        type: item.issue.type,
        typeLabel: TYPE_LABEL[item.issue.type] ?? item.issue.type,
        employee: item.name,
        facts: item.issue.facts,
      }));
      const documents = [...excerpts.entries()].map(([param, list]) => ({
        param,
        excerpts: list.map((d) => ({
          document: docName(d),
          current: d.current,
          text: d.line,
        })),
      }));
      try {
        const { data, sessionId } = await deps.ai.structured({
          employee: 'hrAssistant',
          userId: run.owner.userId,
          title: `算薪异常检查 ${report.month}`,
          prompt: [
            `为 ${report.month} 的算薪异常逐条写说明（每条不超过 120 字），交给薪酬专员复核。`,
            '要求：只陈述数据和可能原因（如“本月事假 5 天”“计件数未导入”），说明需要核对什么、建议向谁核实；不建议调整金额，不评价金额是否合理。',
            '参数取值不一致时，结合下面的制度摘录写清：哪个结构的哪个参数、与哪份制度的哪一条不一致、这个值可能出自哪份文件（含已被取代的旧版本），并列出受影响的员工；由薪酬专员决定是否修改结构。',
            '导入缺人时说明可能的原因（如当月入职、导入文件中没有该工号），建议向谁核实。',
            `异常清单（JSON）：${JSON.stringify(facts)}`,
            documents.length
              ? `制度摘录（JSON）：${JSON.stringify(documents)}`
              : '',
            'notes 中每条的 key 必须与清单中的 key 一致；summary 用一句话概括。',
          ]
            .filter(Boolean)
            .join('\n'),
          schema: notesSchema,
          timeZone: ctx.platform.timeZone,
        });
        run.usedConversation(sessionId);
        summary = data.summary;
        const keys = new Set(report.issues.map((i) => i.issue.key));
        for (const note of data.notes)
          if (keys.has(note.key) && note.note.trim())
            notes.set(note.key, note.note.trim());
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run.markFallback();
        source = 'rule';
      }
      // Anything the model left without a note gets the rule's.
      for (const item of report.issues)
        if (!notes.has(item.issue.key)) {
          notes.set(item.issue.key, templateNote(item, excerpts, affected));
          if (source === 'ai' && !summary) source = 'rule';
        }
    }

    const bySlip = new Map<string, PayslipIssue[]>();
    for (const item of report.issues) {
      const list = bySlip.get(item.payslipId) ?? [];
      list.push({
        ...item.issue,
        note: notes.get(item.issue.key) ?? null,
        noteSource: source,
      });
      bySlip.set(item.payslipId, list);
    }
    const after = new Set(report.issues.map((i) => i.issue.key));
    const added = report.issues.filter((i) => !before.has(i.issue.key));
    const removedKeys = [...before.keys()].filter((key) => !after.has(key));
    const now = new Date();
    const slips = await cycles.payslipsOf(cycleId);
    await database.transaction(async (connection) => {
      // The list is replaced as a whole.
      for (const slip of slips)
        await connection.query
          .updateTable('payslips')
          .set({ issues: bySlip.get(slip.id) ?? [], updatedAt: now })
          .where('id', '=', slip.id)
          .execute();
      await connection.query
        .updateTable('payrollCycles')
        .set({
          review: {
            calculationId,
            checkedAt: now.toISOString(),
            total: report.issues.length,
            added: added.map((i) => i.issue.key),
            removed: removedKeys,
            runId: run.runId,
            summary: summary || null,
          },
          updatedAt: now,
        })
        .where('id', '=', cycleId)
        .where('calculationId', '=', calculationId)
        .execute();
    });

    const label = (key: string, employeeName: string) =>
      `${employeeName} ${TYPE_LABEL[key.split(':')[0]] ?? key.split(':')[0]}`;
    const names = new Map(report.issues.map((i) => [i.employeeId, i.name]));
    const employeesById = new Map(
      (
        await database
          .query()
          .selectFrom('employees')
          .select(['id', 'name'])
          .execute()
      ).map((e) => [str(e.id), str(e.name)]),
    );
    const addedText = added
      .map((i) => label(i.issue.key, i.name))
      .slice(0, 20)
      .join('；');
    const removedText = removedKeys
      .map((key) => {
        const employeeId = before.get(key) ?? '';
        return label(
          key,
          names.get(employeeId) ?? employeesById.get(employeeId) ?? '',
        );
      })
      .slice(0, 20)
      .join('；');
    await ctx.platform.notify({
      key: `payrollCheck:${cycleId}:${calculationId}`,
      userIds: [run.owner.userId],
      message: report.issues.length
        ? 'payrollAnomalies'
        : 'payrollAnomaliesClean',
      params: {
        month: cycle.month,
        count: String(report.issues.length),
        added: addedText || '无',
        removed: removedText || '无',
      },
      path: `/talent/payroll/${cycleId}?tab=anomalies`,
    });
    // The run record: employee ids and issue types only — never an amount.
    run.summarize(
      `${cycle.month} 算薪检查：${report.issues.length} 条异常，新增 ${added.length}，消除 ${removedKeys.length}`,
    );
    run.reference({
      cycleId,
      calculationId,
      issues: report.issues.map((i) => ({
        employeeId: i.employeeId,
        type: i.issue.type,
      })),
    });
    return {
      output: {
        cycleId,
        total: report.issues.length,
        added: added.length,
        removed: removedKeys.length,
        types: [...new Set(report.issues.map((i) => i.issue.type))],
      },
    };
  }

  function billNote(
    reconciliation: Awaited<ReturnType<VendorBillService['reconciliationFor']>>,
  ): string {
    const t = reconciliation.totals;
    const diffs = reconciliation.lines.filter((l) => l.reason === 'diff');
    const parts = [
      `${reconciliation.vendorName} ${reconciliation.month} 账单：匹配员工的账单工时合计 ${t.billedHours} 小时，考勤工时 ${t.attendanceHours} 小时，差异 ${t.diffHours} 小时。`,
    ];
    if (diffs.length)
      parts.push(
        `差异集中在 ${diffs.length} 人：${diffs
          .map(
            (l) =>
              `${l.name}（${l.employeeNo}）账单 ${l.billedHours} 小时、考勤 ${l.attendanceHours} 小时，差 ${l.diffHours} 小时`,
          )
          .join('；')}。`,
      );
    const unmatched = reconciliation.lines.filter(
      (l) => l.reason === 'notMatched',
    );
    if (unmatched.length)
      parts.push(
        `${unmatched.length} 行工号在员工档案中不存在：${unmatched.map((l) => l.employeeNo).join('、')}。`,
      );
    const absent = reconciliation.lines.filter(
      (l) => l.reason === 'notInAttendance',
    );
    if (absent.length)
      parts.push(
        `${absent.length} 人本月没有已锁定的考勤：${absent.map((l) => l.name).join('、')}。`,
      );
    parts.push(
      '建议向派遣公司核实差异工时的出勤依据，确认或标记有争议由薪酬专员决定。',
    );
    return parts.join('');
  }

  async function billReview(run: AutomationRunContext, billId: string) {
    const settings = await ctx.settings();
    const employee = settings.vendorBill.aiEmployee;
    const reconciliation = await bills.reconciliationFor(run.owner, billId);
    run.summarize(
      `${reconciliation.vendorName} ${reconciliation.month} 账单核对`,
    );
    run.reference({
      billId,
      employees: reconciliation.lines
        .filter((l) => l.reason)
        .map((l) => ({ employeeId: l.employeeId, type: l.reason })),
    });
    let wrote = false;
    if (employee) {
      try {
        const reply = await deps.ai.reply({
          employee,
          userId: run.owner.userId,
          title: `派遣账单核对 ${reconciliation.vendorName} ${reconciliation.month}`,
          text: `请核对派遣账单 ${billId}：调用 getVendorBillReconciliation 读取服务端核对结果，按人写出差异说明，再调用 saveVendorBillNotes 保存。不要确认账单，也不要对外发送。`,
          timeZone: ctx.platform.timeZone,
        });
        run.usedConversation(reply.sessionId);
        const bill = await bills.get(run.owner, billId);
        if (bill.aiNotes) wrote = true;
        else if (reply.text.trim() && !reply.paused) {
          await bills.saveNotes(run.owner, billId, reply.text);
          wrote = true;
        }
      } catch {
        // No model, or the employee is missing: the rule-based note below.
        run.markFallback();
      }
      if (!wrote) {
        await bills.saveNotes(run.owner, billId, billNote(reconciliation));
        wrote = true;
      }
    }
    const recipients = [
      ...new Set([run.owner.userId, ...(await ctx.payrollUsers())]),
    ];
    await ctx.platform.notify({
      key: `vendorBill:${billId}:${run.runId}`,
      userIds: recipients,
      message: wrote
        ? 'payrollVendorBillReviewed'
        : 'payrollVendorBillUploaded',
      params: {
        vendor: reconciliation.vendorName,
        month: reconciliation.month,
        diffPeople: String(reconciliation.totals.diffPeople),
        diffHours: String(reconciliation.totals.diffHours),
      },
      path: `/talent/payroll/vendor-bills/${billId}`,
    });
    return { output: { billId, notes: wrote, employee: employee ?? null } };
  }

  return {
    payrollCheck,
    billReview,
    templateNote,

    /** Starts the check of one calculation (the dedupe key is the calculation). */
    check(cycleId: string, calculationId: string) {
      return deps.automation().run(
        PAYROLL_CHECK,
        'event',
        {
          dedupeKey: `${cycleId}:${calculationId}`,
          triggerRef: { cycleId, calculationId },
        },
        (run) => payrollCheck(run, cycleId, calculationId),
      );
    },

    review(billId: string, uploadedAt: string) {
      return deps
        .automation()
        .run(
          BILL_REVIEW,
          'event',
          { dedupeKey: `${billId}:${uploadedAt}`, triggerRef: { billId } },
          (run) => billReview(run, billId),
        );
    },

    json,
  };
}

export type PayrollAssistant = ReturnType<typeof createPayrollAssistant>;
