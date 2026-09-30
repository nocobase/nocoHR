/**
 * V1-02 一句话改配置: an HR administrator says what to change; the HR assistant
 * splits it into drafts of configuration this app already has — an approval
 * chain rule, an added field, a value in 人事设置 — each with a preview. The
 * administrator confirms or discards each draft; only a confirmed draft is
 * written, through the same services the settings pages use. A confirmed
 * change can be reverted. The assistant can never touch permission
 * assignments, salaries or other pages' settings: those kinds do not exist
 * here.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { HrCoreService } from './core-service.js';
import {
  CUSTOM_FIELD_PLACEMENTS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldService,
} from './custom-fields.js';
import type { ActorContext } from './framework-service.js';
import type { OrganizationService } from './organization-service.js';
import {
  CHAIN_ACTION_TYPES,
  CHAIN_RULE_SCHEMA,
  parseSection,
  PERSONNEL_SETTINGS_AUTH,
  type ChainRule,
  type PersonnelSection,
  type PersonnelSettingsService,
} from './personnel-settings.js';
import { HrError, newId, str } from './shared.js';

/** The 人事设置 sections a draft may change; approval chains and fields have their own kinds. */
const DRAFTABLE_SECTIONS = [
  'reminders',
  'probation',
  'selfService',
  'jobInfo',
  'checklists',
  'compliance',
] as const satisfies readonly PersonnelSection[];

const chainDraftSchema = z
  .object({
    type: z.literal('chainRule'),
    /** The department's name as the administrator said it, or its id. */
    department: z.string().trim().min(1).max(100),
    actionTypes: z.array(z.enum(CHAIN_ACTION_TYPES)).min(1),
    name: z.string().trim().min(1).max(60),
    approver: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('departmentHead'),
        department: z.string().trim().max(100).optional(),
      }),
      z.object({ type: z.literal('permissionSet'), key: z.string().min(1) }),
    ]),
    position: z.enum(['afterFirst', 'afterHr']).default('afterFirst'),
  })
  .strict();

const fieldDraftSchema = z
  .object({
    type: z.literal('customField'),
    label: z.string().trim().min(1).max(40),
    fieldType: z.enum(CUSTOM_FIELD_TYPES).default('text'),
    options: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
    placements: z
      .array(z.enum(CUSTOM_FIELD_PLACEMENTS))
      .default(['detail', 'list']),
    required: z.boolean().default(false),
    sensitive: z.boolean().default(false),
  })
  .strict();

const settingDraftSchema = z
  .object({
    type: z.literal('setting'),
    section: z.enum(DRAFTABLE_SECTIONS),
    /** Only the keys that change; merged onto the saved value. */
    changes: z.record(z.string(), z.unknown()),
  })
  .strict();

export const DRAFT_ITEM_SCHEMA = z.discriminatedUnion('type', [
  chainDraftSchema,
  fieldDraftSchema,
  settingDraftSchema,
]);
export type DraftInput = z.infer<typeof DRAFT_ITEM_SCHEMA>;

export interface DraftItem {
  index: number;
  input: DraftInput;
  /** What will be written: a full chain rule, a field definition, or a whole settings section. */
  resolved: Record<string, unknown>;
  preview: Record<string, unknown>;
  /** Things the administrator should know before confirming (同一人审批两次, 找不到审批人). */
  warnings: string[];
  status: 'draft' | 'applied' | 'discarded' | 'reverted';
  /** For a revert: the created field id, the added rule id, or the section's previous value. */
  undo: Record<string, unknown> | null;
}

export interface SettingsChange {
  id: string;
  utterance: string;
  status: 'draft' | 'applied' | 'discarded' | 'reverted' | 'partial';
  items: DraftItem[];
  createdBy: string;
  createdByName: string | null;
  appliedBy: string | null;
  appliedAt: string | null;
  revertedAt: string | null;
  createdAt: string;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function createSettingsDraftService(deps: {
  database: DatabaseManager;
  settings: PersonnelSettingsService;
  customFields: CustomFieldService;
  organization: OrganizationService;
  core: () => HrCoreService;
  userName: (id: string) => Promise<string | null>;
}) {
  const { database } = deps;

  async function requireAdmin(ctx: ActorContext) {
    await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
  }

  async function departmentByName(name: string): Promise<string> {
    const direct = await deps.organization.getDepartment(name);
    if (direct) return direct.id;
    const tree = await deps.organization.listTree();
    const wanted = name.replace(/(及下级|含下级|（含下级）)$/u, '').trim();
    const exact = tree.filter(
      (d) => deps.organization.titleText(d.title) === wanted,
    );
    if (exact.length === 1) return exact[0].id;
    const partial = tree.filter((d) =>
      deps.organization.titleText(d.title).includes(wanted),
    );
    if (partial.length === 1) return partial[0].id;
    throw new HrError('SETTINGS_DRAFT_DEPARTMENT_UNKNOWN', 400, { name });
  }

  async function resolve(
    ctx: ActorContext,
    input: DraftInput,
  ): Promise<Pick<DraftItem, 'resolved' | 'preview' | 'warnings'>> {
    if (input.type === 'chainRule') {
      const departmentId = await departmentByName(input.department);
      const approver =
        input.approver.type === 'departmentHead'
          ? {
              type: 'departmentHead' as const,
              departmentId: input.approver.department
                ? await departmentByName(input.approver.department)
                : departmentId,
            }
          : { type: 'permissionSet' as const, key: input.approver.key };
      const rule: ChainRule = CHAIN_RULE_SCHEMA.parse({
        id: newId(),
        departmentId,
        actionTypes: [...new Set(input.actionTypes)],
        name: input.name,
        approver,
        position: input.position,
        enabled: true,
      });
      // Tried on the rule's own department and each child without its own head, as an action of the first type.
      const steps = await deps.core().previewChain(ctx, {
        actionType: rule.actionTypes[0],
        departmentId,
        extraRules: [rule],
      });
      const warnings: string[] = [];
      for (const step of steps) {
        if (step.merged?.length) warnings.push('merged');
        if (step.fallback === 'noApprover') warnings.push('noApprover');
      }
      return {
        resolved: { rule },
        preview: {
          departmentTitle: deps.organization.titleText(
            (await deps.organization.getDepartment(departmentId))?.title ??
              departmentId,
          ),
          steps: steps.map((s) => ({
            level: s.level,
            kind: s.kind,
            name: s.name ?? null,
            approverNames: s.approverNames,
            merged: s.merged ?? [],
            fallback: s.fallback ?? null,
          })),
        },
        warnings: [...new Set(warnings)],
      };
    }
    if (input.type === 'customField') {
      const existing = await deps.customFields.list('employees');
      const warnings = existing.some(
        (d) => d.active && d.label['zh-CN'] === input.label,
      )
        ? ['duplicateLabel']
        : [];
      const choice =
        input.fieldType === 'select' || input.fieldType === 'multiSelect';
      if (choice && !input.options.length)
        throw new HrError('CUSTOM_FIELD_OPTIONS_REQUIRED', 400);
      const field = {
        collection: 'employees',
        label: { 'zh-CN': input.label, 'en-US': null },
        type: input.fieldType,
        options: choice
          ? input.options.map((o, i) => ({
              value: `o${i + 1}`,
              label: o,
              active: true,
            }))
          : [],
        placements: input.sensitive
          ? input.placements.filter((p) => p !== 'selfService')
          : input.placements,
        required: input.required,
        sensitive: input.sensitive,
        aiReadable: false,
      };
      return { resolved: { field }, preview: { field }, warnings };
    }
    const current = (await deps.settings.read(input.section)).value as Record<
      string,
      unknown
    >;
    const merged = { ...current, ...input.changes };
    for (const [key, value] of Object.entries(input.changes))
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        current[key] &&
        typeof current[key] === 'object'
      )
        merged[key] = { ...current[key], ...value };
    const value = parseSection(input.section, merged);
    if (!value)
      throw new HrError('SETTINGS_DRAFT_INVALID', 400, {
        section: input.section,
      });
    const changed = Object.keys(input.changes).map((key) => ({
      key,
      before: current[key] ?? null,
      after: (value as Record<string, unknown>)[key] ?? null,
    }));
    return {
      resolved: { section: input.section, value },
      preview: { changed },
      warnings: [],
    };
  }

  async function toChange(
    row: Record<string, unknown>,
  ): Promise<SettingsChange> {
    const iso = (v: unknown) =>
      v == null ? null : new Date(str(v)).toISOString();
    return {
      id: str(row.id),
      utterance: str(row.utterance),
      status: str(row.status) as SettingsChange['status'],
      items: parseJson<DraftItem[]>(row.items, []),
      createdBy: str(row.createdBy),
      createdByName: await deps.userName(str(row.createdBy)),
      appliedBy: row.appliedBy == null ? null : str(row.appliedBy),
      appliedAt: iso(row.appliedAt),
      revertedAt: iso(row.revertedAt),
      createdAt: iso(row.createdAt) ?? '',
    };
  }

  async function load(id: string): Promise<SettingsChange> {
    const row = await database
      .query()
      .selectFrom('settingsChangeLog')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('NOT_FOUND', 404);
    return toChange(row);
  }

  async function save(
    change: SettingsChange,
    values: Record<string, unknown> = {},
  ) {
    const statuses = new Set(change.items.map((i) => i.status));
    const status: SettingsChange['status'] =
      statuses.size === 1
        ? [...statuses][0]
        : statuses.has('draft')
          ? 'draft'
          : 'partial';
    await database
      .query()
      .updateTable('settingsChangeLog')
      .set({
        items: JSON.stringify(change.items),
        status,
        updatedAt: new Date(),
        ...values,
      })
      .where('id', '=', change.id)
      .execute();
  }

  async function writeSection(
    ctx: ActorContext,
    section: PersonnelSection,
    value: unknown,
  ) {
    const { revision } = await deps.settings.read(section);
    await deps.settings.update(ctx, section, { revision, value });
  }

  return {
    /** Called by the HR assistant's tool in the administrator's conversation: stores drafts, writes nothing else. */
    async draft(ctx: ActorContext, utterance: string, inputs: unknown) {
      await requireAdmin(ctx);
      const parsed = z
        .array(DRAFT_ITEM_SCHEMA)
        .min(1)
        .max(10)
        .safeParse(inputs);
      if (!parsed.success) throw new HrError('SETTINGS_DRAFT_INVALID', 400);
      const items: DraftItem[] = [];
      for (const [index, input] of parsed.data.entries())
        items.push({
          index,
          input,
          ...(await resolve(ctx, input)),
          status: 'draft',
          undo: null,
        });
      const id = newId();
      const stamp = new Date();
      await database
        .query()
        .insertInto('settingsChangeLog')
        .values({
          id,
          utterance: utterance.slice(0, 2000),
          status: 'draft',
          items: JSON.stringify(items),
          createdBy: ctx.userId,
          appliedBy: null,
          appliedAt: null,
          revertedBy: null,
          revertedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return load(id);
    },

    async list(ctx: ActorContext) {
      await requireAdmin(ctx);
      const rows = await database
        .query()
        .selectFrom('settingsChangeLog')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .limit(50)
        .execute();
      const out: SettingsChange[] = [];
      for (const row of rows) out.push(await toChange(row));
      return out;
    },

    /** Confirms (or discards) one draft item; a confirmed item is written through the normal services. */
    async decide(
      ctx: ActorContext,
      id: string,
      index: number,
      decision: 'apply' | 'discard',
    ) {
      await requireAdmin(ctx);
      const change = await load(id);
      const item = change.items.find((i) => i.index === index);
      if (!item || item.status !== 'draft')
        throw new HrError('SETTINGS_DRAFT_NOT_OPEN', 409);
      if (decision === 'discard') {
        item.status = 'discarded';
        await save(change);
        return load(id);
      }
      if (item.input.type === 'chainRule') {
        const rule = item.resolved.rule as ChainRule;
        const current = (await deps.settings.read('approvalChain')).value;
        await writeSection(ctx, 'approvalChain', {
          ...current,
          rules: [...current.rules, rule],
        });
        item.undo = { ruleId: rule.id };
      } else if (item.input.type === 'customField') {
        const created = await deps.customFields.create(
          ctx,
          item.resolved.field,
        );
        item.undo = { fieldId: created.id };
      } else {
        const section = item.resolved.section as PersonnelSection;
        const before = (await deps.settings.read(section)).value;
        await writeSection(ctx, section, item.resolved.value);
        item.undo = { section, before };
      }
      item.status = 'applied';
      await save(change, { appliedBy: ctx.userId, appliedAt: new Date() });
      return load(id);
    },

    /** Undoes every applied item of a change: the rule removed, the field deactivated, the section restored. */
    async revert(ctx: ActorContext, id: string) {
      await requireAdmin(ctx);
      const change = await load(id);
      const applied = change.items.filter((i) => i.status === 'applied');
      if (!applied.length) throw new HrError('SETTINGS_DRAFT_NOT_APPLIED', 409);
      for (const item of applied) {
        const undo = item.undo ?? {};
        if (typeof undo.ruleId === 'string') {
          const current = (await deps.settings.read('approvalChain')).value;
          await writeSection(ctx, 'approvalChain', {
            ...current,
            rules: current.rules.filter((r) => r.id !== undo.ruleId),
          });
        } else if (typeof undo.fieldId === 'string') {
          await deps.customFields.setActive(ctx, undo.fieldId, false);
        } else if (typeof undo.section === 'string') {
          await writeSection(
            ctx,
            undo.section as PersonnelSection,
            undo.before,
          );
        }
        item.status = 'reverted';
      }
      await save(change, { revertedBy: ctx.userId, revertedAt: new Date() });
      return load(id);
    },
  };
}

export type SettingsDraftService = ReturnType<
  typeof createSettingsDraftService
>;
