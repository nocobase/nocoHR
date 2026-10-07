/**
 * The HR assistant's V1-02 additions that follow the rules:
 *
 * - 变动影响清单说明: a checklist was created or its items changed — word a
 *   summary (the easiest thing to miss first) and one short note per item.
 * - 用工合规检查: the rules found new labour-contract issues — word a notice
 *   for each, citing the article and saying it is a prompt, not legal advice,
 *   and send it to the task owner.
 *
 * The facts come from the services; the AI only words them. Without a model
 * the templates below say the same thing.
 */
import { z } from 'zod';

import { AIShapeError } from './ai-runner.js';
import type { AutomationRunContext } from './automation.js';
import type {
  Checklist,
  ChecklistItem,
  ChecklistService,
} from './change-checklists.js';
import {
  COMPLIANCE_ARTICLES,
  complianceFallback,
  type ComplianceService,
} from './compliance.js';
import type { Platform } from './platform.js';
import { describeWorkItems } from './work-item-store.js';

/** A change checklist's totals, given to the HR assistant so it does not count by itself. */
export function checklistCounts(items: readonly { status: string }[]) {
  return {
    total: items.length,
    hrTodo: items.filter((i) => i.status === 'todo').length,
    systemDone: items.filter((i) => i.status !== 'todo').length,
  };
}

/** Whether a note states a number of items (“N 项”) that is none of the list's own totals. */
export function miscounts(
  summary: string,
  counts: ReturnType<typeof checklistCounts>,
): boolean {
  const allowed = new Set(Object.values(counts));
  return [...summary.matchAll(/(\d+)\s*项/gu)].some(
    (m) => !allowed.has(Number(m[1])),
  );
}

type Structured = <T>(
  run: AutomationRunContext,
  employee: string,
  title: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;
type Worded = (
  run: AutomationRunContext,
  compose: () => Promise<string>,
  fallback: () => string,
) => Promise<string>;

/**
 * The office suite an external account belongs to. Items written before the provider was recorded were all
 * Feishu (the only directory then); an unknown one is named generically rather than as one vendor.
 */
function directoryName(provider: string | undefined): string {
  if (provider === undefined) return '飞书';
  return (
    (
      { feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信' } as Record<
        string,
        string
      >
    )[provider] ?? '办公软件'
  );
}

/** Plain Chinese for each item code, used by the template and handed to the model. */
const ITEM_TEXT: Record<string, (p: Record<string, string>) => string> = {
  orgAccessPending: (p) =>
    `生效后部门与数据范围改为${p.department}${p.position ? `·${p.position}` : ''}，由系统自动完成`,
  orgAccessDone: (p) =>
    `部门与数据范围已改为${p.department}${p.position ? `·${p.position}` : ''}`,
  managerChange: (p) => `直属上级还是${p.current}，建议改为${p.suggested}`,
  managerMissing: (p) => `还没有直属上级，建议设为${p.suggested}`,
  contractAmend: () => '工作岗位变化，需要签订岗位变更协议并上传扫描件',
  contractSignNew: () => '入职后一个月内要签订书面劳动合同',
  contractTerminate: (p) =>
    `生效后劳动合同 ${p.contractNo} 将终止，记得出具离职证明`,
  contractNone: () => '没有生效的劳动合同，确认离职手续',
  pendingOpen: (p) =>
    `还有未结单据：待本人审批 ${p.approvals} 张、以本人为对象 ${p.actions} 张、信息修改 ${p.changes} 条`,
  pendingReassign: (p) => `本人还有 ${p.approvals} 张待审批的单据需要改派`,
  accountDisable: (p) => `登录账号需在离职日 ${p.date} 停用`,
  externalAccountDisable: (p) =>
    `${directoryName(p.provider)}账号需在离职日 ${p.date} 停用`,
  handover: () => '指定工作交接人，由部门负责人确认',
  leaveCertificate: () => '出具离职证明',
  accountCreated: () => '登录账号已创建',
  accountOnEffect: () => '入职生效时自动创建登录账号',
  accountNotRequested: () => '入职单没有勾选创建账号，需要时另行开通',
  membershipDone: (p) => `已加入${p.department}`,
  membershipOnEffect: (p) => `入职生效时加入${p.department}`,
  profileMissing: (p) =>
    `入职资料待补：${p.fields
      .split(',')
      .map(
        (f) =>
          ({
            idNumber: '证件信息',
            education: '学历',
            emergencyContact: '紧急联系人',
          })[f] ?? f,
      )
      .join('、')}`,
  customFieldsMissing: (p) => `入职单上的字段还没填：${p.fields}`,
  // V3-08 / V3-09 providers (competency-service, learning-job-events).
  competencyGap: (p) =>
    `${p.competency}当前 ${p.current} 级，新岗位要求 ${p.required} 级`,
  competencyGapUnassessed: (p) =>
    `${p.competency}还没有评定，新岗位要求 ${p.required} 级`,
  learningPathAssigned: (p) =>
    `已分配学习路径「${p.path}」${p.completed ? `，已完成的${p.completed}不重复安排` : ''}${p.attached ? `，新增${p.attached}` : ''}`,
  learningPathPending: (p) => `生效后分配学习路径「${p.path}」`,
  learningCancelled: (p) => `已取消 ${p.count} 项未完成的学习任务：${p.titles}`,
  learningCancelPending: (p) =>
    `生效后取消 ${p.count} 项未完成的学习任务：${p.titles}`,
  learningNoPath: () => '新岗位没有配置学习路径',
  // V2-06 provider (payroll/events).
  salaryStructureCheck: () =>
    '岗位变化，核对薪资结构是否需要调整（发起调薪单）',
  salaryFinalSettlement: () => '离职结算：核对最后一期工资并办理社保减员',
  // V1-02 V2 增补 provider (departed/service.ts); the address itself is never in the text.
  personalEmailGiven: () =>
    '已填写离职后联系邮箱，离职证明和最后一个月的工资条会发到这里',
  personalEmailMissing: () =>
    '还没有离职后联系邮箱，离职证明和工资条无法通过邮件发送',
};

// The template wording of a compliance prompt lives in compliance.ts, where the page falls back to it.
export { complianceFallback };

export function itemText(item: Pick<ChecklistItem, 'code' | 'params'>): string {
  return ITEM_TEXT[item.code]?.(item.params) ?? item.code;
}

const KIND_TEXT = {
  onboard: '入职',
  change: '调岗',
  offboard: '离职',
} as const;

export function checklistFallback(checklist: Checklist): {
  summary: string;
  items: Record<string, string>;
} {
  const todo = checklist.items.filter((i) => i.status === 'todo');
  const first = todo.find((i) => i.provider === 'manager') ?? todo[0];
  const summary = todo.length
    ? `${checklist.employeeName}的${KIND_TEXT[checklist.kind]}有 ${todo.length} 项需要处理，最容易漏的是：${itemText(first)}。`
    : `${checklist.employeeName}的${KIND_TEXT[checklist.kind]}清单中的事项已由系统完成。`;
  return {
    summary,
    items: Object.fromEntries(checklist.items.map((i) => [i.key, itemText(i)])),
  };
}

export function createHrAssistantChanges(deps: {
  platform: Platform;
  checklists: () => ChecklistService;
  compliance: () => ComplianceService;
  structured: Structured;
  worded: Worded;
}) {
  const { platform, structured, worded } = deps;

  async function checklistNotes(
    run: AutomationRunContext,
    checklistId: string,
  ) {
    const service = deps.checklists();
    if (!(await service.notesStale(checklistId)))
      return { status: 'skipped' as const, output: { reason: 'upToDate' } };
    const checklist = await service.get(checklistId);
    if (!checklist) return { status: 'skipped' as const, output: {} };
    const fallback = checklistFallback(checklist);
    let notes = fallback;
    // The counts come from the list; the model miscounted them (“需处理 6 项，自动完成 3 项” for 5 and 4).
    const counts = checklistCounts(checklist.items);
    const text = await worded(
      run,
      async () => {
        const result = await structured(
          run,
          'hrAssistant',
          '变动影响清单说明',
          `下面是一名员工${KIND_TEXT[checklist.kind]}的变动影响清单。请写一段不超过 120 字的说明：先说最容易漏的一项（通常是直属上级或合同），再说需要 HR 做的事；然后为每一项写一句话说明要做什么（不超过 40 字），不要重复已写明的事实，不要增删清单项，不要给法律结论。status=auto 的项由系统自动完成。要说项数时只用 counts 里的数字（total 共几项、hrTodo 需要 HR 处理几项、systemDone 已由系统完成或已处理几项），不要自己数。数据：${JSON.stringify(
            {
              employee: checklist.employeeName,
              kind: checklist.kind,
              counts,
              items: checklist.items.map((i) => ({
                key: i.key,
                status: i.status,
                fact: itemText(i),
              })),
            },
          )}`,
          z.object({
            summary: z.string().min(1).max(400),
            items: z
              .array(z.object({ key: z.string(), note: z.string().max(120) }))
              .max(30),
          }),
        );
        // A count that is not one of the list's own: the rule text is used instead.
        if (miscounts(result.summary, counts))
          throw new AIShapeError('checklist summary miscounts the items');
        notes = {
          summary: result.summary,
          items: {
            ...fallback.items,
            ...Object.fromEntries(
              result.items
                .filter((i) => checklist.items.some((c) => c.key === i.key))
                .map((i) => [i.key, i.note]),
            ),
          },
        };
        return result.summary;
      },
      () => fallback.summary,
    );
    await service.saveNotes(checklistId, { ...notes, summary: text });
    // The workbench to-do for this checklist shows what the HR assistant wrote (工作台 · AI 员工备好的材料).
    const lines = checklist.items
      .map((item) => notes.items[item.key])
      .filter((note): note is string => Boolean(note));
    await describeWorkItems(
      platform.database.query(),
      `checklist:${checklistId}:`,
      [text, ...lines.map((note) => `· ${note}`)].join('\n'),
    );
    run.summarize(
      `为${checklist.employeeName}的${KIND_TEXT[checklist.kind]}清单写了说明`,
    );
    return { output: { checklistId, items: checklist.items.length } };
  }

  async function complianceCheck(
    run: AutomationRunContext,
    employeeId?: string,
  ) {
    const opened = await deps.compliance().check(employeeId);
    if (!opened.length)
      return { status: 'skipped' as const, output: { opened: 0 } };
    for (const issue of opened) {
      const note = await worded(
        run,
        async () =>
          (
            await structured(
              run,
              'hrAssistant',
              '用工合规检查',
              `请把下面这条劳动合同合规问题写成给 HR 的一段提示（不超过 150 字）：说明事实、依据的法条（${COMPLIANCE_ARTICLES[issue.kind]}）和建议 HR 核对的事项；最后一句必须是“提示，不是法律意见，请 HR 核对。”；不要给法律结论。数据：${JSON.stringify(
                { kind: issue.kind, name: issue.employeeName, ...issue.detail },
              )}`,
              z.object({ note: z.string().min(1).max(400) }),
            )
          ).note,
        () => complianceFallback(issue),
      );
      await deps.compliance().saveNote(issue.id, note);
      await platform.notify({
        key: `compliance:${issue.id}`,
        userIds: [run.owner.userId],
        message: 'hrCompliance',
        params: { name: issue.employeeName, text: note.slice(0, 600) },
        path: `/talent/compliance?employeeId=${encodeURIComponent(issue.employeeId)}`,
      });
    }
    run.summarize(`发现 ${opened.length} 条新的用工合规提示`);
    return { output: { opened: opened.length } };
  }

  return { checklistNotes, complianceCheck };
}
