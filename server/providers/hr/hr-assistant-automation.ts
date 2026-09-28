/**
 * The HR assistant's proactive work in V1 step 1: after an Excel import
 * commits, check the data and send the importer (and the task owner) a report
 * with the problems, why they matter and a concrete fix for each — only
 * suggestions, nothing is changed.
 *
 * The problems are computed by rules (`import-check.ts`); the AI words the
 * report. Without a model the report is written from a template (the run is
 * marked `fallback`). Mobile numbers never reach the prompt, the report or
 * the run record.
 */
import { z } from 'zod';

import { AIUnavailableError } from './ai-runner.js';
import { authorizeAction } from './authorize.js';
import type { AutomationRunContext } from './automation.js';
import {
  computeImportIssues,
  type ImportCheckResult,
  type ImportIssue,
  type IssueType,
} from './import-check.js';
import type { OrganizationService } from './organization-service.js';
import type { Platform } from './platform.js';
import { str } from './shared.js';

type Structured = <T>(
  run: AutomationRunContext,
  employee: string,
  title: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;

export interface HrAssistantAutomationDeps {
  readonly platform: Platform;
  readonly organization: () => OrganizationService;
  readonly structured: Structured;
  /** The application's default language; the report is written in it. */
  readonly locale: () => string;
}

const TEXT = {
  'zh-CN': {
    clean: '本次导入未发现问题。',
    summary: (r: ImportCheckResult, total: number) =>
      `本次导入新增 ${r.batch.createdCount} 人、更新 ${r.batch.updatedCount} 人、新建岗位 ${r.batch.createdPositions.length} 个，发现 ${total} 项待处理（需处理 ${r.counts.mustFix} 项，建议处理 ${r.counts.suggested} 项）。`,
    groups: { mustFix: '需处理', suggested: '建议处理' },
    groupNote: {
      mustFix: '会让数据范围或后续审批出错',
      suggested: '影响档案完整和统计准确',
    },
    types: {
      duplicateEmployee: '疑似重复员工',
      managerCycle: '上级链有环',
      departmentNoHead: '部门未设负责人',
      noManager: '缺直属上级',
      noPosition: '员工未设岗位',
      similarPositions: '岗位名称相近未统一',
    } satisfies Record<IssueType, string>,
    why: {
      duplicateEmployee: '同一人两条档案会让统计、审批和后续学习任务重复',
      managerCycle: '上级链有环时，按上级找审批人和汇报关系会失效',
      departmentNoHead: '没有负责人的部门，主管范围和审批都要向上找人',
      noManager: '没有直属上级，汇报关系和按上级的提醒找不到人',
      noPosition: '没有岗位的员工拿不到按岗位分配的权限',
      similarPositions: '岗位不统一会让按岗位分配的权限只覆盖一部分人',
    } satisfies Record<IssueType, string>,
    who: '涉及',
    reason: '原因',
    fix: '建议',
    view: '查看',
    more: (shown: number, total: number) =>
      `（共 ${total} 条，此处列出前 ${shown} 条，其余通过链接查看）`,
    sameNameMobile: '姓名与手机号相同',
  },
  'en-US': {
    clean: 'No problems were found in this import.',
    summary: (r: ImportCheckResult, total: number) =>
      `This import created ${r.batch.createdCount} and updated ${r.batch.updatedCount} employees and created ${r.batch.createdPositions.length} positions. ${total} items need attention (${r.counts.mustFix} must fix, ${r.counts.suggested} suggested).`,
    groups: { mustFix: 'Must fix', suggested: 'Suggested' },
    groupNote: {
      mustFix: 'these break data scopes or later approvals',
      suggested: 'these affect record completeness and statistics',
    },
    types: {
      duplicateEmployee: 'Possible duplicate employee',
      managerCycle: 'Manager chain loop',
      departmentNoHead: 'Department without a head',
      noManager: 'No direct manager',
      noPosition: 'No position',
      similarPositions: 'Similar position titles',
    } satisfies Record<IssueType, string>,
    why: {
      duplicateEmployee:
        'two records for one person double statistics, approvals and learning tasks',
      managerCycle:
        'a loop breaks approvals and reporting that follow the manager chain',
      departmentNoHead:
        'without a head, manager scope and approvals go to the department above',
      noManager: 'reminders and approvals that go to the manager reach nobody',
      noPosition: 'people without a position get no position-based permissions',
      similarPositions:
        'split titles mean position-based permissions cover only some of the people',
    } satisfies Record<IssueType, string>,
    who: 'Who',
    reason: 'Why',
    fix: 'Suggestion',
    view: 'View',
    more: (shown: number, total: number) =>
      `(${total} in total; the first ${shown} are listed, the rest via the link)`,
    sameNameMobile: 'same name and mobile',
  },
};

function describe(issue: ImportIssue): string {
  return issue.records
    .map((r) => (r.code ? `${r.name}（${r.code}）` : r.name))
    .join('、');
}

/** The report written by rule, in the same shape the prompt asks the AI for. */
export function templateReport(
  result: ImportCheckResult,
  perTypeLimit: number,
  locale: string,
): string {
  const text = locale.startsWith('en') ? TEXT['en-US'] : TEXT['zh-CN'];
  if (!result.issues.length) return text.clean;
  const lines = [text.summary(result, result.issues.length), ''];
  for (const severity of ['mustFix', 'suggested'] as const) {
    const group = result.issues.filter((i) => i.severity === severity);
    if (!group.length) continue;
    lines.push(
      `### ${text.groups[severity]}（${group.length}）`,
      `${text.groupNote[severity]}`,
      '',
    );
    for (const type of Object.keys(text.types) as IssueType[]) {
      const items = group.filter((i) => i.type === type);
      if (!items.length) continue;
      lines.push(`**${text.types[type]}**`);
      for (const issue of items.slice(0, perTypeLimit)) {
        const who =
          type === 'duplicateEmployee'
            ? `${describe(issue)}（${text.sameNameMobile}）`
            : describe(issue);
        lines.push(
          `- ${text.who}：${who}；${text.reason}：${text.why[type]}；${text.fix}：${issue.suggestion}。[${text.view}](${issue.link})`,
        );
      }
      if (items.length > perTypeLimit)
        lines.push(text.more(perTypeLimit, items.length));
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

export function createHrAssistantAutomation(deps: HrAssistantAutomationDeps) {
  const { platform, structured } = deps;

  async function importCheck(run: AutomationRunContext, batchId: string) {
    // Only an owner who may import employees (hr.admin) sees the whole organisation the check reads.
    await authorizeAction(run.owner.authz, 'talent.employee', 'import');
    const perTypeLimit = Math.max(
      1,
      Math.round(Number(run.params.perTypeLimit ?? 20)),
    );
    const result = await computeImportIssues(
      platform,
      deps.organization(),
      batchId,
      {
        synonyms: str(run.params.synonyms ?? ''),
        editDistance: Math.max(0, Number(run.params.editDistance ?? 1)),
      },
    );
    const total = result.issues.length;
    run.summarize(
      `导入批次 ${batchId}：新增 ${result.batch.createdCount}，更新 ${result.batch.updatedCount}，新建岗位 ${result.batch.createdPositions.length}；问题 ${total} 项（需处理 ${result.counts.mustFix}，建议处理 ${result.counts.suggested}）`,
    );
    // References are record ids and types only.
    run.reference(
      result.issues.map((issue) => ({
        type: issue.type,
        records: issue.records.map((r) => ({ type: r.type, id: r.id })),
      })),
    );
    const locale = deps.locale();
    let report: string;
    /** Why the template replaced the AI's report, for the run record. */
    let fallbackReason: string | null = null;
    if (!total) report = templateReport(result, perTypeLimit, locale);
    else {
      try {
        const perType = new Map<string, number>();
        const shown = result.issues.filter((issue) => {
          const key = `${issue.severity}:${issue.type}`;
          perType.set(key, (perType.get(key) ?? 0) + 1);
          return perType.get(key)! <= perTypeLimit;
        });
        const answer = await structured(
          run,
          'hrAssistant',
          `导入数据体检：${batchId}`,
          [
            `请根据下面服务端算出的导入体检结果，写一份给 HR 的体检报告（Markdown，${locale.startsWith('en') ? '用英文' : '用简体中文'}）。`,
            '要求：只根据给出的问题写，不要推断其他问题；开头一句写本次导入的新增、更新、新建岗位数和问题总数；然后按“需处理”“建议处理”分组（先写一句该组的含义：需处理会让数据范围或后续审批出错，建议处理影响档案完整和统计准确），组内按问题类型排列。',
            '每条写清四件事：什么问题、涉及谁（姓名与工号）、为什么要处理（结合部门和岗位说具体影响）、建议怎么改（具体到哪个字段改成什么值），最后附上给出的 link，写成 Markdown 链接。',
            '只给建议，不要说已经修改。是否为同一人、保留哪个岗位名称，列出判断依据，由 HR 决定。重复员工只写“姓名与手机号相同”，报告中不出现手机号。',
            `每类最多列 ${perTypeLimit} 条；某类超过时写明总数，其余通过链接查看。`,
            `导入摘要：${JSON.stringify({
              batchId,
              importedBy: result.batch.importedByName,
              created: result.batch.createdCount,
              updated: result.batch.updatedCount,
              createdPositions: result.batch.createdPositions,
              mustFix: result.counts.mustFix,
              suggested: result.counts.suggested,
            })}`,
            `问题清单：${JSON.stringify(
              shown.map((issue) => ({
                type: issue.type,
                severity: issue.severity,
                records: issue.records.map((r) => ({
                  name: r.name,
                  code: r.code,
                })),
                facts: issue.facts,
                suggestion: issue.suggestion,
                link: issue.link,
              })),
            )}`,
            `各类总数：${JSON.stringify(
              Object.fromEntries(
                [...new Set(result.issues.map((i) => i.type))].map((type) => [
                  type,
                  result.issues.filter((i) => i.type === type).length,
                ]),
              ),
            )}`,
          ].join('\n'),
          z.object({ report: z.string().min(1) }),
        );
        report = answer.report.trim().slice(0, 20_000);
        // A report that dropped the links or leaked a mobile number is replaced by the template.
        if (
          !result.issues
            .slice(0, 1)
            .every((issue) => report.includes(issue.link.split('?')[0])) ||
          /1\d{10}/u.test(report)
        ) {
          run.markFallback();
          fallbackReason = 'reportRejected';
          report = templateReport(result, perTypeLimit, locale);
        }
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run.markFallback();
        fallbackReason = error.message.slice(0, 300);
        report = templateReport(result, perTypeLimit, locale);
      }
    }
    // Recipients: the importer, and the owner when someone else imported. A clean import only tells the importer.
    const recipients = [
      ...new Set(
        total
          ? [result.batch.importedByUserId, run.owner.userId]
          : [result.batch.importedByUserId],
      ),
    ];
    await platform.notify({
      key: `importCheck:${batchId}:${run.runId}`,
      userIds: recipients,
      message: total ? 'hrImportCheck' : 'hrImportCheckClean',
      params: {
        batch: batchId,
        mustFix: String(result.counts.mustFix),
        suggested: String(result.counts.suggested),
        report,
      },
      path: `/talent/employees?batch=${encodeURIComponent(batchId)}`,
    });
    await platform.database
      .query()
      .updateTable('employeeImportBatches')
      .set({
        checkSummary: JSON.stringify(result.counts),
        checkReport: report,
        checkRunId: run.runId,
        updatedAt: new Date(),
      })
      .where('id', '=', batchId)
      .execute();
    return {
      output: {
        batchId,
        mustFix: result.counts.mustFix,
        suggested: result.counts.suggested,
        recipients,
        report,
        ...(fallbackReason ? { fallbackReason } : {}),
      },
    };
  }

  return { importCheck };
}
