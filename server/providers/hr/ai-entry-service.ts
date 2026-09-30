/**
 * 统一 AI 入口 (V1-04): one entry — the header's "AI 助手", the 问答 page and
 * office-suite bots — that hands a question to one AI employee by an
 * administrator-adjustable routing table. The AI employee plugin has no
 * routing between employees, so this is the application's routing step: a
 * model classifies the question into one row key (no business tools), with
 * a keyword rule when no model is available.
 *
 * Routing never widens access: a row the user is not in the audience of
 * takes no part, and the chosen employee still runs its own tools with the
 * user's scope. The same settings hold each employee's knowledge scope
 * (document numbers or categories), intersected with what the user may read.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from './ai-runner.js';
import { authorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import { HrError, isRecord } from './shared.js';

export const AI_ASSISTANT = 'talent.aiAssistant';
const SETTINGS_ID = 'aiEntry';

const routeSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u),
    description: z.string().trim().min(1).max(200),
    employee: z.string().min(1).max(64),
    // Permission set keys whose holders may use the row; empty is everyone.
    permissionSets: z.array(z.string().min(1).max(128)).max(20),
    enabled: z.boolean(),
    // Words that send a question here when no model is available.
    keywords: z.array(z.string().trim().min(1).max(20)).max(40),
  })
  .strict();
const scopeSchema = z
  .object({
    docNos: z.array(z.string().trim().min(1).max(64)).max(200),
    categories: z.array(z.enum(['policy', 'sop', 'manual', 'other'])).max(4),
  })
  .strict();
const settingsSchema = z
  .object({
    // Order is priority; the last enabled row everyone may use is the fallback.
    routes: z
      .array(routeSchema)
      .min(1)
      .max(50)
      .refine((rows) => new Set(rows.map((r) => r.key)).size === rows.length),
    knowledgeScopes: z.record(z.string(), scopeSchema),
  })
  .strict();
export type AiEntrySettings = z.infer<typeof settingsSchema>;

const SELF_SERVICE_ID = 'selfServiceCards';
const selfServiceSchema = z
  .object({
    // Display order; `visible: false` hides the card for everyone.
    cards: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/u),
            visible: z.boolean(),
          })
          .strict(),
      )
      .max(50)
      .refine((rows) => new Set(rows.map((r) => r.key)).size === rows.length),
  })
  .strict();
export type SelfServiceCards = z.infer<typeof selfServiceSchema>;

export const DEFAULT_AI_ENTRY: AiEntrySettings = {
  routes: [
    // V3-10: 证书与复审 → 认证管家; 考试成绩 → 考官. Everyone may ask about their own; the tools scope it.
    {
      key: 'certificates',
      description: '证书、持证、到期、复审',
      employee: 'certificationSteward',
      permissionSets: [],
      enabled: true,
      keywords: ['证书', '持证', '到期', '复审'],
    },
    {
      key: 'examResults',
      description: '考试成绩、扣分、没通过的原因',
      employee: 'examiner',
      permissionSets: [],
      enabled: true,
      keywords: ['考试', '扣分', '没过', '成绩'],
    },
    // V2-06: 工资、社保、个税 go to the HR assistant (own data only); in office-suite bots they get a link only.
    {
      key: 'myPay',
      description: '我的工资、工资条、社保、公积金、个税',
      employee: 'hrAssistant',
      permissionSets: [],
      enabled: true,
      keywords: ['工资', '工资条', '薪资', '社保', '公积金', '个税', '扣税', '津贴怎么算'],
    },
    {
      key: 'myRecord',
      description: '我的档案、合同、试用期、异动记录、考勤、假期、排班',
      employee: 'hrAssistant',
      permissionSets: [],
      enabled: true,
      keywords: [
        '我的',
        '合同',
        '试用期',
        '转正',
        '异动',
        '档案',
        '入职日期',
        '考勤',
        '迟到',
        '缺卡',
        '补卡',
        '排班',
        '班次',
        '请假',
        '还有几天',
        '余额',
        // V2-05 (realigned): 请一天事假、调班、打卡 in the bot reach the HR assistant too.
        '事假',
        '病假',
        '调班',
        '早退',
        '打卡',
        // V1-04: 在飞书里改本人信息 (the HR assistant drafts a 本人提交 card).
        '住址',
        '搬家',
        '手机号',
        '紧急联系人',
      ],
    },
    // V4-12: 绩效 → 绩效助理 (own goals, reviews and progress; heads and HR for their scope). After myRecord:
    // “我的考核到哪一步了” still reaches it (two keyword hits against one).
    {
      key: 'performance',
      description: '绩效：我的考核进度、目标、自评与互评、考核规则、评语与校准',
      employee: 'performanceAssistant',
      permissionSets: [],
      enabled: true,
      keywords: ['我的考核', '考核进度', '考核到哪', '考核结果', '考核方案', '绩效', '自评', '互评', '评语', '校准', '申诉'],
    },
    {
      key: 'hrData',
      description: '导入体检、同步待处理项',
      employee: 'hrAssistant',
      permissionSets: ['hr.admin'],
      enabled: true,
      keywords: ['导入', '体检', '同步', '待处理'],
    },
    {
      key: 'policy',
      description: '制度、规定、作业要求（如夜班津贴、年假规则、车间安全）',
      employee: 'knowledgeAssistant',
      permissionSets: [],
      enabled: true,
      keywords: [
        '制度',
        '规定',
        '津贴',
        '年假',
        '安全',
        '首饰',
        '手套',
        '加班',
        '作业',
      ],
    },
    // V3-11: 团队、找人、画像 → 人才分析师, for HR administrators and department heads.
    {
      key: 'teamInsight',
      description: '团队能力与风险、找人（按技能/证书/经历）、员工画像摘要',
      employee: 'talentAnalyst',
      permissionSets: ['hr.admin', 'hr.manager'],
      enabled: true,
      keywords: ['团队', '找人', '谁会', '谁有', '画像', '能力分布', '人才'],
    },
    // V3-08: 岗位能力模型 → 体系顾问, for HR administrators.
    {
      key: 'frameworkModel',
      description: '岗位能力模型：能力项、等级描述、岗位要求草稿',
      employee: 'frameworkAdvisor',
      permissionSets: ['hr.admin'],
      enabled: true,
      keywords: ['能力模型', '能力项', '岗位要求', '能力词典', '胜任力'],
    },
    {
      key: 'other',
      description: '其他：由知识助手说明可以问哪些问题',
      employee: 'knowledgeAssistant',
      permissionSets: [],
      enabled: true,
      keywords: [],
    },
  ],
  knowledgeScopes: {},
};

export function createAiEntryService(deps: {
  readonly database: DatabaseManager;
  readonly ai: AIRunner;
  readonly timeZone: string;
  /** Everyone who holds a permission set now. */
  readonly holdersOf: (setKey: string) => Promise<string[]>;
  readonly permissionSetKeys: () => Promise<string[]>;
  /** AI employees the plugin knows, for validating a row's target. */
  readonly employees: () => Promise<string[]>;
}) {
  const { database } = deps;

  async function read(): Promise<{ value: AiEntrySettings; revision: number }> {
    const row = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', SETTINGS_ID)
      .executeTakeFirst();
    let stored: unknown = row?.value;
    for (let i = 0; i < 3 && typeof stored === 'string'; i++)
      stored = JSON.parse(stored);
    const parsed = settingsSchema.safeParse(stored);
    return {
      value: parsed.success ? parsed.data : DEFAULT_AI_ENTRY,
      revision: Number(row?.revision ?? 0),
    };
  }

  /** The enabled rows the user is in the audience of, in priority order. */
  async function availableRoutes(userId: string) {
    const { routes } = (await read()).value;
    const result: AiEntrySettings['routes'] = [];
    for (const route of routes) {
      if (!route.enabled) continue;
      if (!route.permissionSets.length) {
        result.push(route);
        continue;
      }
      for (const key of route.permissionSets)
        if ((await deps.holdersOf(key)).includes(userId)) {
          result.push(route);
          break;
        }
    }
    return result;
  }

  function byKeywords(question: string, routes: AiEntrySettings['routes']) {
    const text = question.toLowerCase();
    let best: { route: (typeof routes)[number]; hits: number } | undefined;
    for (const route of routes) {
      const hits = route.keywords.filter((k) =>
        text.includes(k.toLowerCase()),
      ).length;
      if (hits && (!best || hits > best.hits)) best = { route, hits };
    }
    return best?.route;
  }

  async function readSelfService(): Promise<{
    value: SelfServiceCards;
    revision: number;
  }> {
    const row = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', SELF_SERVICE_ID)
      .executeTakeFirst();
    let stored: unknown = row?.value;
    for (let i = 0; i < 3 && typeof stored === 'string'; i++)
      stored = JSON.parse(stored);
    const parsed = selfServiceSchema.safeParse(stored);
    return {
      value: parsed.success ? parsed.data : { cards: [] },
      revision: Number(row?.revision ?? 0),
    };
  }

  return {
    read,

    async get(ctx: ActorContext) {
      await authorizeAction(ctx.authz, AI_ASSISTANT, 'configure');
      return {
        ...(await read()),
        employees: await deps.employees(),
        permissionSets: await deps.permissionSetKeys(),
      };
    },

    async update(ctx: ActorContext, input: unknown) {
      await authorizeAction(ctx.authz, AI_ASSISTANT, 'configure');
      const body = z
        .object({ revision: z.number().int().min(0), value: settingsSchema })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const known = new Set(await deps.employees());
      const sets = new Set(await deps.permissionSetKeys());
      for (const route of body.data.value.routes) {
        if (!known.has(route.employee))
          throw new HrError('AI_ENTRY_EMPLOYEE_UNKNOWN', 400, {
            key: route.key,
          });
        if (route.permissionSets.some((key) => !sets.has(key)))
          throw new HrError('SETTINGS_PERMISSION_SET_NOT_FOUND', 400, {
            key: route.key,
          });
      }
      if (
        !body.data.value.routes.some(
          (r) => r.enabled && !r.permissionSets.length,
        )
      )
        throw new HrError('AI_ENTRY_NO_FALLBACK', 400);
      const current = await read();
      if (current.revision !== body.data.revision)
        throw new HrError('SETTINGS_CONFLICT', 409);
      const stamp = new Date();
      const value = JSON.stringify(body.data.value);
      if (current.revision)
        await database
          .query()
          .updateTable('personnelSettings')
          .set({
            value,
            revision: current.revision + 1,
            updatedBy: ctx.userId,
            updatedAt: stamp,
          })
          .where('id', '=', SETTINGS_ID)
          .where('revision', '=', current.revision)
          .execute();
      else
        await database
          .query()
          .insertInto('personnelSettings')
          .values({
            id: SETTINGS_ID,
            value,
            revision: 1,
            updatedBy: ctx.userId,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      return { value: body.data.value, revision: current.revision + 1 };
    },

    /** The rows this user may be routed to, for example questions on an empty chat. */
    async routesFor(ctx: ActorContext) {
      await authorizeAction(ctx.authz, AI_ASSISTANT, 'use');
      return (await availableRoutes(ctx.userId)).map((r) => ({
        key: r.key,
        description: r.description,
        employee: r.employee,
      }));
    },

    /** Picks one row for a question: the model classifies, keywords decide without one. */
    async route(ctx: ActorContext, question: unknown) {
      await authorizeAction(ctx.authz, AI_ASSISTANT, 'use');
      if (typeof question !== 'string' || !question.trim())
        throw new HrError('INVALID_INPUT', 400);
      const routes = await availableRoutes(ctx.userId);
      if (!routes.length) throw new HrError('AI_ENTRY_NO_ROUTE', 409);
      const fallback =
        [...routes].reverse().find((r) => !r.permissionSets.length) ??
        routes.at(-1)!;
      let chosen: (typeof routes)[number] | undefined;
      let method: 'model' | 'keywords' | 'fallback' = 'fallback';
      try {
        const { data } = await deps.ai.structured({
          employee: 'knowledgeAssistant',
          userId: ctx.userId,
          title: 'AI 入口路由',
          prompt: `把用户的问题归到下面其中一行，只输出该行的 key。\n${JSON.stringify(
            routes.map((r) => ({ key: r.key, description: r.description })),
          )}\n问题：${question.trim().slice(0, 500)}`,
          schema: z.object({ key: z.string() }),
          timeZone: deps.timeZone,
          timeoutMs: 30_000,
        });
        chosen = routes.find((r) => r.key === data.key);
        if (chosen) method = 'model';
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
      }
      if (!chosen) {
        chosen = byKeywords(question, routes);
        if (chosen) method = 'keywords';
      }
      chosen ??= fallback;
      return {
        key: chosen.key,
        employee: chosen.employee,
        description: chosen.description,
        method,
        // The other employees the user may be handed to ("转给 X").
        alternatives: [...new Set(routes.map((r) => r.employee))].filter(
          (e) => e !== chosen.employee,
        ),
      };
    },

    /**
     * 自助 page cards (V1-04 “卡片的顺序和显隐是管理员可调整的应用配置”):
     * the order and the hidden ones, by card key. The page appends cards the
     * list does not name (a later step's new card) and still hides a card
     * the user may not open. Any signed-in user reads it; it holds no data.
     */
    selfServiceCards: readSelfService,

    async updateSelfServiceCards(ctx: ActorContext, input: unknown) {
      await authorizeAction(ctx.authz, AI_ASSISTANT, 'configure');
      const body = z
        .object({ revision: z.number().int().min(0), value: selfServiceSchema })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const current = await readSelfService();
      if (current.revision !== body.data.revision)
        throw new HrError('SETTINGS_CONFLICT', 409);
      const stamp = new Date();
      // An object: the query builder encodes JSON columns itself.
      const value = body.data.value as never;
      if (current.revision)
        await database
          .query()
          .updateTable('personnelSettings')
          .set({
            value,
            revision: current.revision + 1,
            updatedBy: ctx.userId,
            updatedAt: stamp,
          })
          .where('id', '=', SELF_SERVICE_ID)
          .where('revision', '=', current.revision)
          .execute();
      else
        await database
          .query()
          .insertInto('personnelSettings')
          .values({
            id: SELF_SERVICE_ID,
            value,
            revision: 1,
            updatedBy: ctx.userId,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      return { value: body.data.value, revision: current.revision + 1 };
    },

    /** 知识范围 for an employee: document numbers or categories it may search; empty is no limit. */
    async scopeFor(employee: string) {
      const scopes = (await read()).value.knowledgeScopes;
      const scope = isRecord(scopes) ? scopes[employee] : undefined;
      return scope ?? { docNos: [], categories: [] };
    },
  };
}

export type AiEntryService = ReturnType<typeof createAiEntryService>;
