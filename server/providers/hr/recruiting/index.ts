/**
 * V2-07 用工计划与招聘入职: the recruiting services, built once by the
 * provider (server/providers/hr/index.ts, V2-07 block) and resolved through
 * `recruitingServicesToken`. Background work (the assistants' runs) starts
 * after the request that caused it answers.
 */
import { ApiKeyService } from '@nocobase/app-plugin-api-keys/server';

import { authorizeAction } from '../authorize.js';
import type { BotTurnHook } from '../im-channel.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, str } from '../shared.js';
import { createAiInterview } from './ai-interview.js';
import { createRecruitingAssistant } from './assistant.js';
import { createCalendar } from './calendar.js';
import { createCandidateService } from './candidates.js';
import { classifyReply, createCheckIns } from './checkins.js';
import {
  readRecruitingSettings,
  writeRecruitingSettings,
} from './config.js';
import { createRecruitingContext, type RecruitingDeps } from './context.js';
import { createInterviewService } from './interviews.js';
import { createOfferService } from './offers.js';
import { createOnboarding } from './onboarding.js';
import { createPostingService } from './postings.js';
import { createPreboarding, PREBOARDING_EXTRACT } from './preboarding.js';
import { createPublicService } from './public.js';
import { createReports } from './reports.js';
import { createRequisitionService } from './requisitions.js';
import { COMPOSITE } from './resources.js';
import { createRecruitingTasks } from './tasks.js';
import { createTemplates } from './templates.js';
import { createWorkforceService } from './workforce.js';

const INTEGRATION_SET = 'hr.integrationErp';
const KEYS_ID = 'recruiting.integrationKeys';

export function createRecruitingServices(deps: RecruitingDeps) {
  const ctx = createRecruitingContext(deps);
  const later = <T>(label: string, run: () => Promise<T>) =>
    deps.background(label, run);
  const templates = createTemplates(ctx);
  const calendar = createCalendar(ctx);

  // The assistant (created below) is reached from these hooks only when they run, after it exists.

  const requisitions = createRequisitionService(ctx, {
    onOpened: (id) =>
      later('recruitingAssistant.requisitionOpened', () =>
        assistant.onRequisitionOpened(id),
      ),
  });
  const workforce = createWorkforceService(ctx, {
    onCalculated: (planId) =>
      later('hrAssistant.workforceExplain', async () => {
        const plan = await workforce.trustedGet(planId);
        return assistant.onPlanCalculated(planId, plan.calculationHash);
      }),
    createDraftRequisition: ({ plan, actor }) =>
      requisitions.draftFromPlan({
        plan,
        actor,
        targetDate: workforce.targetDateFor(plan.month),
      }),
  });
  const postings = createPostingService(ctx, { requisitions, calendar });
  const candidates = createCandidateService(ctx, {
    requisitions,
    postings,
    onNewApplication: (id) =>
      later('recruitingAssistant.screening', () =>
        assistant.onNewApplication(id),
      ),
  });
  const interviews = createInterviewService(ctx, {
    candidates,
    calendar,
    templates,
    postings,
    onAllScored: (id) =>
      later('recruitingAssistant.interviewSummary', () =>
        assistant.onAllScored(id),
      ),
  });
  const offers = createOfferService(ctx, { candidates, requisitions, templates });
  const preboarding = createPreboarding(ctx, { offers, templates });
  const publicPages = createPublicService(ctx, {
    postings,
    requisitions,
    candidates,
    interviews,
    offers,
    onUpload: (offerId, fileId) =>
      later(PREBOARDING_EXTRACT, () =>
        ctx
          .automation()
          .run(
            PREBOARDING_EXTRACT,
            'event',
            { triggerRef: { offerId, fileId }, dedupeKey: `upload:${fileId}` },
            (run) => preboarding.extract(run, offerId, fileId),
          ),
      ),
  });
  const assistant = createRecruitingAssistant(ctx, {
    requisitions,
    postings,
    candidates,
    interviews,
    workforce,
  });
  const onboarding = createOnboarding(ctx, { offers, requisitions });
  const checkIns = createCheckIns(ctx);
  const reports = createReports(ctx);
  const aiInterview = createAiInterview(ctx, {
    postings,
    candidates,
    interviews,
    templates,
  });
  const tasks = createRecruitingTasks(ctx, {
    assistant,
    candidates,
    interviews,
    offers,
    postings,
    preboarding,
    checkIns,
  });

  /** 新员工回访: a reply to the bot's question goes to the HR assistant with the check-in's context. */
  const checkInHook: BotTurnHook = {
    async claim({ userId, text }) {
      const open = await checkIns.openFor(userId);
      if (!open) return undefined;
      const settings = await ctx.settings();
      const note = [
        `【新员工回访 checkInId=${open.id}，入职第 ${open.day} 天】这是员工对回访问题的回复。`,
        '按主题（housing 住宿 / shuttle 班车 / mentoring 带教 / schedule 排班 / workload 工作量 / other）整理回复，调用 saveCheckInIssues 保存；先按制度说明能怎么办（用 searchKnowledge，附出处），再告诉员工已经转给谁跟进。语气像 HR 同事，一次只问一件事；员工表示不想回答时结束回访（declined=true）。不代员工提交任何申请。',
        `回访问题：${settings.checkIns.questions.join(' / ')}`,
        '',
      ].join('\n');
      return {
        note,
        async fallback() {
          const t = await ctx.translate();
          const { answers, issues, declined } = classifyReply(text);
          const saved = await checkIns.saveIssuesTrusted(open, {
            answers,
            issues,
            declined,
          });
          if (!issues.length) return t('recruiting.checkIns.thanks');
          // 按制度说明能怎么办（附出处）: the employee's own knowledge search.
          const actor: ActorContext = {
            userId,
            authz: await (await import('../authorize.js')).scopeForUser(
              deps.platform.authz,
              userId,
            ),
          };
          const passages = await ctx
            .knowledge()
            .search(actor, issues.map((i) => i.summary).join(' '), 2)
            .catch(() => []);
          const cite = passages[0]
            ? t('recruiting.checkIns.policy', {
                title: passages[0].documentTitle,
                section: passages[0].sectionTitle,
                excerpt: passages[0].excerpt.slice(0, 80),
                link: deps.publicUrl(passages[0].path),
              })
            : '';
          const routedTo = [
            ...new Set(saved.routed.map((r) => r.to).filter(Boolean)),
          ].join('、');
          return [
            t('recruiting.checkIns.received'),
            cite,
            routedTo ? t('recruiting.checkIns.routed', { names: routedTo }) : '',
          ]
            .filter(Boolean)
            .join('\n');
        },
      };
    },
  };

  const apiKeys = () => new ApiKeyService(ctx.authentication(), 'default');

  async function keyRows(): Promise<
    { id: string; name: string; userId: string; createdAt: string; createdBy: string; disabledAt?: string | null }[]
  > {
    const row = await ctx.database
      .query()
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', KEYS_ID)
      .executeTakeFirst();
    let value: unknown = row?.value;
    for (let i = 0; i < 3 && typeof value === 'string'; i++) value = JSON.parse(value);
    return Array.isArray(value) ? (value as never) : [];
  }

  async function writeKeyRows(rows: unknown[], userId: string) {
    const now = new Date();
    const exists = await ctx.database
      .query()
      .selectFrom('personnelSettings')
      .select(['revision'])
      .where('id', '=', KEYS_ID)
      .executeTakeFirst();
    if (exists)
      await ctx.database
        .query()
        .updateTable('personnelSettings')
        .set({ value: rows, revision: Number(exists.revision) + 1, updatedBy: userId, updatedAt: now })
        .where('id', '=', KEYS_ID)
        .execute();
    else
      await ctx.database
        .query()
        .insertInto('personnelSettings')
        .values({ id: KEYS_ID, value: rows, revision: 1, updatedBy: userId, createdAt: now, updatedAt: now })
        .execute();
  }

  return {
    context: ctx,
    templates,
    requisitions,
    workforce,
    postings,
    candidates,
    interviews,
    offers,
    preboarding,
    publicPages,
    assistant,
    onboarding,
    checkIns,
    reports,
    aiInterview,
    tasks,
    checkInHook,

    settings: {
      async read(actor: ActorContext) {
        await authorizeAction(actor.authz, COMPOSITE.settings, 'manage');
        return readRecruitingSettings(ctx.database);
      },
      async write(actor: ActorContext, input: unknown) {
        await authorizeAction(actor.authz, COMPOSITE.settings, 'manage');
        return writeRecruitingSettings(ctx.database, input, actor.userId);
      },

      /** ERP 集成账号的 API 密钥: shown once, never stored in clear. */
      async integration(actor: ActorContext) {
        await authorizeAction(actor.authz, COMPOSITE.settings, 'manage');
        const holders = await ctx.holdersOf(INTEGRATION_SET);
        return {
          accounts: await Promise.all(
            holders.map(async (id) => ({ id, name: (await deps.platform.userName(id)) ?? id })),
          ),
          keys: (await keyRows()).map((k) => ({ ...k, userName: null })),
        };
      },
      async createKey(actor: ActorContext, input: unknown) {
        await authorizeAction(actor.authz, COMPOSITE.settings, 'manage');
        const holders = await ctx.holdersOf(INTEGRATION_SET);
        const body = (input ?? {}) as { userId?: unknown; name?: unknown };
        const userId = typeof body.userId === 'string' ? body.userId : holders[0];
        if (!userId || !holders.includes(userId)) throw new HrError('INTEGRATION_ACCOUNT_MISSING', 409);
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : 'ERP 排产计划推送';
        const { key, secret } = await apiKeys().create({ userId, name, expiresIn: 365 * 86_400 });
        const rows = await keyRows();
        rows.push({ id: str(key.id), name, userId, createdAt: new Date().toISOString(), createdBy: actor.userId, disabledAt: null });
        await writeKeyRows(rows, actor.userId);
        ctx.audit({ event: 'recruiting.integrationKeyCreated', keyId: str(key.id), by: actor.userId });
        return { id: str(key.id), name, secret };
      },
      async disableKey(actor: ActorContext, id: string) {
        await authorizeAction(actor.authz, COMPOSITE.settings, 'manage');
        const rows = await keyRows();
        const row = rows.find((r) => r.id === id);
        if (!row) throw new HrError('NOT_FOUND', 404);
        await apiKeys().disable(id);
        row.disabledAt = new Date().toISOString();
        await writeKeyRows(rows, actor.userId);
        ctx.audit({ event: 'recruiting.integrationKeyDisabled', keyId: id, by: actor.userId });
        return { id, disabled: true };
      },
    },
  };
}

export type RecruitingServices = ReturnType<typeof createRecruitingServices>;
