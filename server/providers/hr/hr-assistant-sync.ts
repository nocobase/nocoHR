/**
 * 同步问题说明与职务映射起草 (V1-03): after a sync with pending items nobody
 * has explained yet, the HR assistant writes for each item what differs, why
 * the sync did not handle it and which button on the page to use; for titles
 * without a mapping it drafts one when a position clearly matches, and
 * otherwise suggests creating the position first. It changes no employee,
 * department or mapping status: drafts wait for an HR administrator.
 *
 * The facts and the candidate positions come from rules; the AI words the
 * notes (a template without a model). The run record keeps item keys and
 * types only.
 */
import { z } from 'zod';

import { AIUnavailableError } from './ai-runner.js';
import { authorizeAction } from './authorize.js';
import type { AutomationRunContext } from './automation.js';
import {
  ALIAS_DRAFT_ENTITY,
  type AliasService,
} from './org-sync/alias-service.js';
import {
  maskedDetail,
  type OrgSyncService,
  type SyncIssue,
} from './org-sync/sync-service.js';
import type { Platform } from './platform.js';
import { str } from './shared.js';

type Structured = <T>(
  run: AutomationRunContext,
  employee: string,
  title: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;

export interface HrAssistantSyncDeps {
  readonly platform: Platform;
  readonly sync: () => OrgSyncService;
  readonly aliases: () => AliasService;
  readonly structured: Structured;
}

const ADVICE: Record<string, { why: string; action: string }> = {
  unmappedTitle: {
    why: '飞书职务没有已确认的职务映射，同步不会改动该员工的岗位',
    action: '在“职务映射”中新增或确认映射，再点“按新映射重新处理”',
  },
  unknownParentDepartment: {
    why: '部门的上级不在同步范围内或还没有对应部门',
    action: '调整同步范围，或先建立上级部门',
  },
  departmentRemoved: {
    why: '飞书中已删除该部门，但 NocoHR 中仍保留',
    action: '到组织管理中决定是否停用，或忽略',
  },
  departmentAmbiguous: {
    why: '按名称与上级路径匹配到多个部门，无法自动对应',
    action: '手工指定对应的部门',
  },
  duplicateMatch: {
    why: '成员与员工的匹配不唯一，为避免绑错没有绑定',
    action: '核对候选后手工指定绑定关系，或合并重复员工',
  },
  managerOutOfScope: {
    why: '直属上级不在同步范围内或尚未绑定',
    action: '调整同步范围，或忽略',
  },
  noAccount: {
    why: '员工已绑定飞书身份，但还没有 NocoHR 登录账号',
    action: '在员工详情“关联登录用户”，或忽略',
  },
  lockedChange: {
    why: '该员工设置了同步锁定，飞书中的调整没有写入',
    action: '知悉后忽略，或解除锁定',
  },
  newMember: {
    why: '飞书中新出现的成员在 NocoHR 中还没有档案；数据主源为 NocoHR，同步不直接建档',
    action: '先确认职务映射，再“生成入职单草稿”',
  },
  deactivatedMember: {
    why: '飞书中已停用，NocoHR 中仍在职；离职须走离职单',
    action: '“发起离职单”',
  },
  orgMismatch: {
    why: '部门或岗位与飞书不一致；数据主源为 NocoHR，调整须走人事异动',
    action: '发起调岗单或晋升单',
  },
  managerMismatch: {
    why: '直属上级与飞书不一致',
    action: '“采用办公软件的上级”，或忽略',
  },
  departmentManagerMismatch: {
    why: '部门负责人与飞书不一致',
    action: '到组织管理修改负责人，或忽略',
  },
  contractPending: {
    why: '同步产生离职后，该员工仍有生效中的合同',
    action: '到合同管理终止合同，并补填离职原因',
  },
};

/** Groups separated by ";", alternatives by "/"; the first word of a group is its canonical form. */
function normalizer(synonyms: string) {
  const pairs: [string, string][] = [];
  for (const group of synonyms.split(/[;；]/u)) {
    const words = group
      .split('/')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    for (const word of words.slice(1)) pairs.push([word, words[0]]);
  }
  // Longer alternatives first, so 数控机床 is replaced before 数控.
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (title: string) => {
    let value = title.replace(/\s+/gu, '').toLowerCase();
    for (const [from, to] of pairs) value = value.split(from).join(to);
    return value;
  };
}

export function createHrAssistantSync(deps: HrAssistantSyncDeps) {
  const { platform, structured } = deps;

  function describe(issue: SyncIssue): string {
    const who = str(
      issue.detail.name ?? issue.detail.title ?? issue.externalId,
    );
    const advice = ADVICE[issue.type];
    const extra =
      issue.type === 'orgMismatch'
        ? issue.detail.suggestedAction === 'promote'
          ? '（新岗位与原岗位同一序列且职级更高，建议晋升单；是否发起、何时生效由 HR 决定）'
          : '（部门或岗位变化，建议调岗单；是否发起、何时生效由 HR 决定）'
        : issue.type === 'duplicateMatch'
          ? '（只列出候选，不替 HR 判断是哪一位）'
          : '';
    return `${who}：${advice?.why ?? issue.type}${extra}。`;
  }

  async function syncExplain(
    run: AutomationRunContext,
    /** Whoever started the sync by hand is told too. */
    alsoNotify: readonly string[] = [],
  ) {
    await authorizeAction(run.owner.authz, 'talent.orgSync', 'resolveIssues');
    const { issues } = await deps.sync().currentIssues();
    const pending = issues.filter(
      (i) => i.status === 'open' && !i.aiExplainedAt,
    );
    if (!pending.length)
      return { status: 'skipped' as const, output: { explained: 0 } };
    const positions = (
      await platform.database
        .query()
        .selectFrom('positions')
        .select(['id', 'title', 'jobFamilyId', 'grade', 'responsibilities'])
        .where('active', '=', true)
        .execute()
    ).map((p) => ({
      id: str(p.id),
      title: str(p.title),
      jobFamilyId: str(p.jobFamilyId),
      grade: p.grade == null ? null : str(p.grade),
    }));
    const normalize = normalizer(String(run.params.synonyms ?? ''));
    // Rule candidates: a title that normalizes to exactly one position's title.
    const titles = [
      ...new Set(
        pending
          .filter((i) => i.type === 'unmappedTitle')
          .map((i) => str(i.detail.title)),
      ),
    ];
    const ruleMatch = new Map<string, (typeof positions)[number]>();
    for (const title of titles) {
      const hits = positions.filter(
        (p) => normalize(p.title) === normalize(title),
      );
      if (hits.length === 1) ruleMatch.set(title, hits[0]);
    }
    let notes = pending.map((issue) => ({
      key: issue.key,
      aiExplanation: describe(issue),
      aiSuggestedAction: ADVICE[issue.type]?.action ?? '',
    }));
    let drafts = [...ruleMatch].map(([title, position]) => ({
      provider: 'feishu',
      externalTitle: title,
      positionId: position.id,
      draftReason: `名称同义：“${title}”与岗位“${position.title}”按同义词归一后一致`,
    }));
    try {
      const reply = await structured(
        run,
        'hrAssistant',
        '同步问题说明',
        `以下是组织同步的待处理项（已脱敏）和启用的岗位。请逐条写 explanation（哪里不一致、为什么同步没有处理，不超过 120 字）和 suggestedAction（对应页面上已有的处理按钮），并为 unmappedTitle 中职责明显一致的职务给出 aliases（externalTitle、positionId、reason）；没有合适岗位就不给，并在说明中建议 HR 先新建岗位。不猜测人员身份，不出现手机号。\n待处理项：${JSON.stringify(
          pending.map((i) => ({
            key: i.key,
            type: i.type,
            // Mobile numbers and email addresses never reach the model.
            detail: maskedDetail(i.detail),
            rule: ADVICE[i.type],
          })),
        )}\n岗位：${JSON.stringify(positions)}`,
        z.object({
          notes: z.array(
            z.object({
              key: z.string(),
              explanation: z.string().min(1).max(400),
              suggestedAction: z.string().max(200),
            }),
          ),
          aliases: z.array(
            z.object({
              externalTitle: z.string(),
              positionId: z.string(),
              reason: z.string().min(1).max(400),
            }),
          ),
        }),
      );
      const byKey = new Map(reply.notes.map((n) => [n.key, n]));
      notes = notes.map((n) => {
        const ai = byKey.get(n.key);
        return ai
          ? {
              key: n.key,
              aiExplanation: ai.explanation,
              aiSuggestedAction: ai.suggestedAction,
            }
          : n;
      });
      // Only titles that are really unmapped, only active positions.
      const known = new Set(positions.map((p) => p.id));
      const aiDrafts = reply.aliases
        .filter(
          (a) => titles.includes(a.externalTitle) && known.has(a.positionId),
        )
        .map((a) => ({
          provider: 'feishu',
          externalTitle: a.externalTitle,
          positionId: a.positionId,
          draftReason: a.reason,
        }));
      const covered = new Set(aiDrafts.map((d) => d.externalTitle));
      drafts = [
        ...aiDrafts,
        ...drafts.filter((d) => !covered.has(d.externalTitle)),
      ];
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
    }
    // Titles with no draft: the note says to create the position first.
    const drafted = new Set(drafts.map((d) => d.externalTitle));
    notes = notes.map((n) => {
      const issue = pending.find((i) => i.key === n.key)!;
      if (
        issue.type === 'unmappedTitle' &&
        !drafted.has(str(issue.detail.title))
      )
        return {
          ...n,
          aiSuggestedAction: `没有职责一致的岗位：建议先在“人事 / 岗位”新建岗位，再为“${str(issue.detail.title)}”新增映射`,
        };
      return n;
    });
    await deps.sync().saveNotes(notes);
    const aliases = await deps.aliases().createDrafts(drafts);
    // Each draft is a run item, so confirming, editing or discarding it counts toward the adoption rate.
    await run.recordItems(
      ALIAS_DRAFT_ENTITY,
      aliases.items.map((item) => ({ id: item.id, hash: item.positionId })),
    );
    run.reference(pending.map((i) => ({ key: i.key, type: i.type })));
    const counts: Record<string, number> = {};
    for (const i of pending) counts[i.type] = (counts[i.type] ?? 0) + 1;
    run.summarize(
      `说明 ${pending.length} 项待处理（${Object.entries(counts)
        .map(([type, n]) => `${type} ${n}`)
        .join('、')}），起草职务映射 ${aliases.created.length} 条`,
    );
    await platform.notify({
      key: `automation:syncExplain:${run.runId}`,
      userIds: [...new Set([run.owner.userId, ...alsoNotify])],
      message: 'hrSyncExplained',
      params: {
        count: String(pending.length),
        drafts: String(aliases.created.length),
        types: Object.entries(counts)
          .map(([type, n]) => `${type} × ${n}`)
          .join('、'),
      },
      path: '/settings/org-sync/issues',
    });
    return {
      output: {
        explained: pending.length,
        drafts: aliases.created.length,
        skippedDrafts: aliases.skipped.length,
      },
    };
  }

  return { syncExplain };
}
