/**
 * V1-02 变动影响清单: what an onboarding, a transfer / promotion or an
 * offboarding touches, listed once so nothing is forgotten.
 *
 * - A transfer or promotion gets a `preview` while its action awaits approval
 *   (the approver sees it), and becomes `open` for HR once it takes effect.
 * - An onboarding or offboarding becomes `open` as soon as its action is
 *   fully approved (the effective date is often in the future), and is
 *   refreshed when it takes effect.
 * - A sync-produced change (V1-03 external mode) opens directly from its
 *   job event.
 *
 * Items come from providers — plain rules over the records. Later steps
 * register theirs (schedule, salary, competency gaps, learning, certificates,
 * grants). The HR assistant writes a summary and one note per item; it never
 * adds, removes or resolves an item. Items HR has handled keep their state
 * across refreshes.
 */
import { createHash } from 'node:crypto';

import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { CustomFieldService } from './custom-fields.js';
import { readValues } from './custom-fields.js';
import type { ActorContext } from './framework-service.js';
import type { JobEvent } from './job-events.js';
import type { OrganizationService } from './organization-service.js';
import type { Notify } from './platform.js';
import { addDays, HrError, newId, str, today, toDateOnly } from './shared.js';

export const CHECKLIST_KINDS = ['onboard', 'change', 'offboard'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export const CHECKLIST_STAGES = [
  'preview',
  'open',
  'done',
  'cancelled',
] as const;
export type ChecklistStage = (typeof CHECKLIST_STAGES)[number];
export const ITEM_STATUSES = ['auto', 'todo', 'done', 'notNeeded'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface ChecklistItem {
  /** Stable within a checklist, so HR's handling survives a refresh. */
  key: string;
  provider: string;
  /** A translation key under `talent.checklists.items`, with its parameters. */
  code: string;
  params: Record<string, string>;
  status: ItemStatus;
  /** An app-internal page where the item is handled. */
  link: string | null;
  /** An action the checklist can perform itself, e.g. adopting the suggested manager. */
  action: { type: 'adoptManager'; employeeId: string } | null;
  note: string | null;
  /** The HR assistant's one-line explanation. */
  aiNote: string | null;
  handledBy: string | null;
  handledAt: string | null;
}

export interface ChecklistActionRow {
  id: string;
  actionType: string;
  status: string;
  employeeId: string | null;
  candidate: Record<string, unknown>;
  fromDepartmentId: string | null;
  fromPositionId: string | null;
  toDepartmentId: string | null;
  toPositionId: string | null;
  effectiveDate: string;
}

export interface ChecklistEmployee {
  id: string;
  name: string;
  userId: string | null;
  departmentId: string;
  positionId: string | null;
  managerEmployeeId: string | null;
  externalUserId: string | null;
  status: string;
  customFields: Record<string, unknown>;
}

export interface ProviderContext {
  kind: ChecklistKind;
  stage: 'preview' | 'open';
  /** Whether the change has taken effect (department, position, status already written). */
  effective: boolean;
  action: ChecklistActionRow | null;
  event: JobEvent | null;
  employee: ChecklistEmployee | null;
  database: DatabaseManager;
  organization: OrganizationService;
  customFields: CustomFieldService;
}

export type ProviderItem = Omit<
  ChecklistItem,
  'provider' | 'note' | 'aiNote' | 'handledBy' | 'handledAt' | 'link' | 'action'
> & { link?: string | null; action?: ChecklistItem['action'] };

export interface ChecklistProvider {
  key: string;
  kinds: readonly ChecklistKind[];
  items(context: ProviderContext): Promise<ProviderItem[]>;
}

export interface Checklist {
  id: string;
  employeeId: string | null;
  employeeName: string;
  kind: ChecklistKind;
  actionId: string | null;
  jobEventId: string | null;
  stage: ChecklistStage;
  items: ChecklistItem[];
  aiSummary: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  openedAt: string | null;
  doneAt: string | null;
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

function toChecklist(row: Record<string, unknown>): Checklist {
  const iso = (value: unknown) =>
    value == null ? null : new Date(str(value)).toISOString();
  return {
    id: str(row.id),
    employeeId: row.employeeId == null ? null : str(row.employeeId),
    employeeName: str(row.employeeName),
    kind: str(row.kind) as ChecklistKind,
    actionId: row.actionId == null ? null : str(row.actionId),
    jobEventId: row.jobEventId == null ? null : str(row.jobEventId),
    stage: str(row.stage) as ChecklistStage,
    items: parseJson<ChecklistItem[]>(row.items, []),
    aiSummary: row.aiSummary == null ? null : str(row.aiSummary),
    ownerUserId: row.ownerUserId == null ? null : str(row.ownerUserId),
    dueDate: toDateOnly(row.dueDate as string | null),
    openedAt: iso(row.openedAt),
    doneAt: iso(row.doneAt),
    createdAt: iso(row.createdAt) ?? '',
  };
}

function kindOfAction(actionType: string): ChecklistKind | null {
  if (actionType === 'onboard') return 'onboard';
  if (actionType === 'offboard') return 'offboard';
  if (actionType === 'transfer' || actionType === 'promote') return 'change';
  return null;
}

function hashItems(items: readonly ChecklistItem[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(items.map((i) => [i.key, i.code, i.params, i.status])),
    )
    .digest('hex')
    .slice(0, 32);
}

/** The providers V1-02 ships; later steps register more through `register`. */
export function coreProviders(): ChecklistProvider[] {
  const departmentTitle = async (ctx: ProviderContext, id: string | null) =>
    id
      ? ctx.organization.titleText(
          (await ctx.organization.getDepartment(id))?.title ?? id,
        )
      : '';
  const positionTitle = async (ctx: ProviderContext, id: string | null) => {
    if (!id) return '';
    const row = await ctx.database
      .query()
      .selectFrom('positions')
      .select(['title'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? str(row.title) : id;
  };
  const employeeName = async (ctx: ProviderContext, id: string | null) => {
    if (!id) return '';
    const row = await ctx.database
      .query()
      .selectFrom('employees')
      .select(['name'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? str(row.name) : '';
  };

  return [
    {
      key: 'orgAccess',
      kinds: ['change'],
      async items(ctx) {
        const to =
          ctx.action?.toDepartmentId ?? ctx.event?.toDepartmentId ?? null;
        const toPosition =
          ctx.action?.toPositionId ?? ctx.event?.toPositionId ?? null;
        return [
          {
            key: 'orgAccess',
            code: ctx.effective ? 'orgAccessDone' : 'orgAccessPending',
            params: {
              department: await departmentTitle(ctx, to),
              position: await positionTitle(ctx, toPosition),
            },
            status: 'auto',
          },
        ];
      },
    },
    {
      key: 'manager',
      kinds: ['change'],
      async items(ctx) {
        const employee = ctx.employee;
        const target =
          ctx.action?.toDepartmentId ?? ctx.event?.toDepartmentId ?? null;
        if (!employee || !target) return [];
        const head = await ctx.organization.resolveHead(target);
        if (!head) return [];
        const suggested = await ctx.database
          .query()
          .selectFrom('employees')
          .select(['id', 'name'])
          .where('userId', '=', head.userId)
          .executeTakeFirst();
        // The employee heads the target: their own manager is not this checklist's question.
        if (!suggested || str(suggested.id) === employee.id) return [];
        if (employee.managerEmployeeId === str(suggested.id)) return [];
        return [
          {
            key: 'manager',
            code: employee.managerEmployeeId
              ? 'managerChange'
              : 'managerMissing',
            params: {
              current: await employeeName(ctx, employee.managerEmployeeId),
              suggested: str(suggested.name),
            },
            status: 'todo',
            link: `/talent/employees/${employee.id}`,
            action: { type: 'adoptManager', employeeId: str(suggested.id) },
          },
        ];
      },
    },
    {
      key: 'contract',
      kinds: ['onboard', 'change', 'offboard'],
      async items(ctx) {
        const employee = ctx.employee;
        if (ctx.kind === 'onboard')
          return [
            {
              key: 'contract',
              code: 'contractSignNew',
              params: {},
              status: 'todo',
              link: '/talent/contracts',
            },
          ];
        if (!employee) return [];
        const active = await ctx.database
          .query()
          .selectFrom('employmentContracts')
          .select(['contractNo'])
          .where('employeeId', '=', employee.id)
          .where('status', '=', 'active')
          .executeTakeFirst();
        if (ctx.kind === 'offboard')
          return [
            {
              key: 'contract',
              code: active ? 'contractTerminate' : 'contractNone',
              params: { contractNo: active ? str(active.contractNo) : '' },
              status: 'todo',
              link: `/talent/contracts?employeeId=${encodeURIComponent(employee.id)}`,
            },
          ];
        return [
          {
            key: 'contract',
            code: 'contractAmend',
            params: { contractNo: active ? str(active.contractNo) : '' },
            status: 'todo',
            link: `/talent/contracts?employeeId=${encodeURIComponent(employee.id)}`,
          },
        ];
      },
    },
    {
      key: 'pendingItems',
      kinds: ['change', 'offboard'],
      async items(ctx) {
        const employee = ctx.employee;
        if (!employee) return [];
        const actions = await ctx.database
          .query()
          .selectFrom('personnelActions')
          .select([
            'id',
            'currentApproverUserIds',
            'employeeId',
            'applicantUserId',
          ])
          .where('status', 'in', ['pending', 'approved'])
          .execute();
        const others = actions.filter((a) => str(a.id) !== ctx.action?.id);
        const asApprover = employee.userId
          ? others.filter((a) =>
              parseJson<string[]>(a.currentApproverUserIds, []).includes(
                employee.userId!,
              ),
            ).length
          : 0;
        const asSubject = others.filter(
          (a) => a.employeeId != null && str(a.employeeId) === employee.id,
        ).length;
        const changes = await ctx.database
          .query()
          .selectFrom('profileChangeRequests')
          .select(['id'])
          .where('employeeId', '=', employee.id)
          .where('status', '=', 'pending')
          .execute();
        const total = asApprover + asSubject + changes.length;
        if (!total) return [];
        return [
          {
            key: 'pendingItems',
            code:
              ctx.kind === 'offboard' && asApprover
                ? 'pendingReassign'
                : 'pendingOpen',
            params: {
              approvals: String(asApprover),
              actions: String(asSubject),
              changes: String(changes.length),
            },
            status: 'todo',
            link: '/talent/actions',
          },
        ];
      },
    },
    {
      key: 'account',
      kinds: ['offboard', 'change'],
      async items(ctx) {
        const employee = ctx.employee;
        if (!employee) return [];
        // V1-03: a change keeps the office-suite account; the sync follows the new department.
        if (ctx.kind === 'change')
          return employee.externalUserId
            ? [
                {
                  key: 'externalAccount',
                  code: 'externalAccountUnchanged',
                  params: {},
                  status: 'auto',
                  link: null,
                },
              ]
            : [];
        const items: ProviderItem[] = [];
        if (employee.userId)
          items.push({
            key: 'account',
            code: 'accountDisable',
            params: { date: ctx.action?.effectiveDate ?? '' },
            status: 'todo',
            link: null,
          });
        if (employee.externalUserId)
          items.push({
            key: 'externalAccount',
            code: 'externalAccountDisable',
            params: { date: ctx.action?.effectiveDate ?? '' },
            status: 'todo',
            link: null,
          });
        return items;
      },
    },
    {
      key: 'handover',
      kinds: ['offboard'],
      async items() {
        return [
          {
            key: 'handover',
            code: 'handover',
            params: {},
            status: 'todo',
            link: null,
          },
          {
            key: 'leaveCertificate',
            code: 'leaveCertificate',
            params: {},
            status: 'todo',
            link: null,
          },
        ];
      },
    },
    {
      key: 'onboardAccount',
      kinds: ['onboard'],
      async items(ctx): Promise<ProviderItem[]> {
        const createAccount = ctx.action?.candidate.createAccount === true;
        return [
          {
            key: 'onboardAccount',
            code: createAccount
              ? ctx.effective
                ? 'accountCreated'
                : 'accountOnEffect'
              : 'accountNotRequested',
            params: {},
            status: createAccount ? 'auto' : 'todo',
          },
          {
            key: 'onboardMembership',
            code: ctx.effective ? 'membershipDone' : 'membershipOnEffect',
            params: {
              department: await departmentTitle(
                ctx,
                ctx.action?.toDepartmentId ?? null,
              ),
            },
            status: 'auto',
          },
        ];
      },
    },
    {
      key: 'onboardProfile',
      kinds: ['onboard'],
      async items(ctx) {
        const items: ProviderItem[] = [];
        const employee = ctx.employee;
        // Before the effect there is no record yet: the whole profile is still to be completed.
        const missing: string[] = [];
        if (!employee)
          missing.push('idNumber', 'education', 'emergencyContact');
        else {
          const row = await ctx.database
            .query()
            .selectFrom('employees')
            .select(['idNumber'])
            .where('id', '=', employee.id)
            .executeTakeFirst();
          if (!row?.idNumber) missing.push('idNumber');
          const education = await ctx.database
            .query()
            .selectFrom('employeeEducations')
            .select(['id'])
            .where('employeeId', '=', employee.id)
            .executeTakeFirst();
          if (!education) missing.push('education');
          const contact = await ctx.database
            .query()
            .selectFrom('employeeEmergencyContacts')
            .select(['id'])
            .where('employeeId', '=', employee.id)
            .executeTakeFirst();
          if (!contact) missing.push('emergencyContact');
        }
        if (missing.length)
          items.push({
            key: 'onboardProfile',
            code: 'profileMissing',
            params: { fields: missing.join(',') },
            status: 'todo',
            link: employee ? `/talent/employees/${employee.id}` : null,
          });
        // Added fields placed on the onboarding form that are still empty (工服尺码, 宿舍号…).
        const definitions = ctx.customFields.visible(
          await ctx.customFields.list('employees'),
          { sensitive: true, placement: 'onboardForm' },
        );
        const values = employee
          ? employee.customFields
          : readValues(ctx.action?.candidate.customFields);
        const empty = definitions.filter((d) => values[d.key] == null);
        if (empty.length)
          items.push({
            key: 'onboardCustomFields',
            code: 'customFieldsMissing',
            params: { fields: empty.map((d) => d.label['zh-CN']).join('、') },
            status: 'todo',
            link: employee ? `/talent/employees/${employee.id}` : null,
          });
        return items;
      },
    },
  ];
}

export interface ChecklistServiceDeps {
  database: DatabaseManager;
  organization: OrganizationService;
  customFields: CustomFieldService;
  notify: Notify;
  timeZone: string;
  /** Who owns checklists: the HR assistant task's owner, else every HR administrator. */
  owners: () => Promise<string[]>;
  /** Whether the caller administers HR (the `talent.hr` settings item). */
  isHrAdmin: (ctx: ActorContext) => Promise<boolean>;
  /** Asks the HR assistant to (re)write the notes; runs in the background. */
  onItemsChanged?: () => ((checklistId: string) => void) | undefined;
  /** Adopts a manager for an employee, as the caller (checked like an edit). */
  setManager: (
    ctx: ActorContext,
    employeeId: string,
    managerId: string,
  ) => Promise<void>;
}

const handleSchema = z
  .object({
    status: z.enum(['done', 'notNeeded', 'todo']),
    note: z.string().trim().max(300).nullable().default(null),
  })
  .strict();

export function createChecklistService(deps: ChecklistServiceDeps) {
  const { database } = deps;
  const providers: ChecklistProvider[] = coreProviders();

  async function loadAction(id: string): Promise<ChecklistActionRow | null> {
    const row = await database
      .query()
      .selectFrom('personnelActions')
      .select([
        'id',
        'actionType',
        'status',
        'employeeId',
        'candidate',
        'fromDepartmentId',
        'fromPositionId',
        'toDepartmentId',
        'toPositionId',
        'effectiveDate',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: str(row.id),
      actionType: str(row.actionType),
      status: str(row.status),
      employeeId: row.employeeId == null ? null : str(row.employeeId),
      candidate: parseJson<Record<string, unknown>>(row.candidate, {}),
      fromDepartmentId:
        row.fromDepartmentId == null ? null : str(row.fromDepartmentId),
      fromPositionId:
        row.fromPositionId == null ? null : str(row.fromPositionId),
      toDepartmentId:
        row.toDepartmentId == null ? null : str(row.toDepartmentId),
      toPositionId: row.toPositionId == null ? null : str(row.toPositionId),
      effectiveDate: toDateOnly(row.effectiveDate as string | null) ?? '',
    };
  }

  async function loadEmployee(
    id: string | null,
  ): Promise<ChecklistEmployee | null> {
    if (!id) return null;
    const row = await database
      .query()
      .selectFrom('employees')
      .select([
        'id',
        'name',
        'userId',
        'departmentId',
        'positionId',
        'managerEmployeeId',
        'externalUserId',
        'status',
        'customFields',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: str(row.id),
      name: str(row.name),
      userId: row.userId == null ? null : str(row.userId),
      departmentId: str(row.departmentId),
      positionId: row.positionId == null ? null : str(row.positionId),
      managerEmployeeId:
        row.managerEmployeeId == null ? null : str(row.managerEmployeeId),
      externalUserId:
        row.externalUserId == null ? null : str(row.externalUserId),
      status: str(row.status),
      customFields: readValues(row.customFields),
    };
  }

  async function compute(
    context: Omit<
      ProviderContext,
      'database' | 'organization' | 'customFields'
    >,
  ) {
    const full: ProviderContext = {
      ...context,
      database,
      organization: deps.organization,
      customFields: deps.customFields,
    };
    const items: ChecklistItem[] = [];
    for (const provider of providers) {
      if (!provider.kinds.includes(context.kind)) continue;
      for (const item of await provider.items(full))
        items.push({
          ...item,
          provider: provider.key,
          link: item.link ?? null,
          action: item.action ?? null,
          note: null,
          aiNote: null,
          handledBy: null,
          handledAt: null,
        });
    }
    return items;
  }

  /** Keeps what HR already handled, and the assistant's notes, for items that are still there. */
  function merge(
    previous: readonly ChecklistItem[],
    next: ChecklistItem[],
  ): ChecklistItem[] {
    const byKey = new Map(previous.map((i) => [i.key, i]));
    return next.map((item) => {
      const before = byKey.get(item.key);
      if (!before) return item;
      const handled =
        item.status !== 'auto' &&
        (before.status === 'done' || before.status === 'notNeeded');
      return {
        ...item,
        status: handled ? before.status : item.status,
        note: before.note,
        handledBy: handled ? before.handledBy : null,
        handledAt: handled ? before.handledAt : null,
        aiNote: before.code === item.code ? before.aiNote : null,
      };
    });
  }

  async function findBy(
    field: 'actionId' | 'jobEventId',
    value: string,
  ): Promise<Checklist | undefined> {
    const row = await database
      .query()
      .selectFrom('jobChangeChecklists')
      .selectAll()
      .where(field, '=', value)
      .executeTakeFirst();
    return row ? toChecklist(row) : undefined;
  }

  async function write(
    existing: Checklist | undefined,
    values: {
      employeeId: string | null;
      employeeName: string;
      kind: ChecklistKind;
      actionId: string | null;
      jobEventId: string | null;
      stage: ChecklistStage;
      items: ChecklistItem[];
      dueDate: string | null;
    },
  ): Promise<{ checklist: Checklist; changed: boolean; opened: boolean }> {
    const stamp = new Date();
    const hash = hashItems(values.items);
    const opened =
      values.stage === 'open' && (!existing || existing.stage === 'preview');
    const owners = opened || !existing?.ownerUserId ? await deps.owners() : [];
    const ownerUserId = existing?.ownerUserId ?? owners[0] ?? null;
    if (existing) {
      const row = await database
        .query()
        .selectFrom('jobChangeChecklists')
        .select(['itemsHash'])
        .where('id', '=', existing.id)
        .executeTakeFirst();
      const changed =
        str(row?.itemsHash ?? '') !== hash || existing.stage !== values.stage;
      await database
        .query()
        .updateTable('jobChangeChecklists')
        .set({
          employeeId: values.employeeId,
          employeeName: values.employeeName,
          jobEventId: values.jobEventId ?? existing.jobEventId,
          stage: values.stage,
          items: JSON.stringify(values.items),
          itemsHash: hash,
          ownerUserId,
          dueDate: values.dueDate,
          openedAt: opened
            ? stamp
            : existing.openedAt
              ? new Date(existing.openedAt)
              : null,
          updatedAt: stamp,
        })
        .where('id', '=', existing.id)
        .execute();
      return { checklist: (await get(existing.id))!, changed, opened };
    }
    const id = newId();
    await database
      .query()
      .insertInto('jobChangeChecklists')
      .values({
        id,
        ...values,
        items: JSON.stringify(values.items),
        itemsHash: hash,
        aiSummary: null,
        notesHash: null,
        ownerUserId,
        openedAt: values.stage === 'open' ? stamp : null,
        doneAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    return {
      checklist: (await get(id))!,
      changed: true,
      opened: values.stage === 'open',
    };
  }

  async function get(id: string): Promise<Checklist | undefined> {
    const row = await database
      .query()
      .selectFrom('jobChangeChecklists')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toChecklist(row) : undefined;
  }

  async function announce(
    checklist: Checklist,
    opened: boolean,
    changed: boolean,
  ) {
    if (changed) deps.onItemsChanged?.()?.(checklist.id);
    if (!opened) return;
    const recipients = checklist.ownerUserId
      ? [checklist.ownerUserId]
      : await deps.owners();
    await deps.notify({
      key: `checklist:${checklist.id}:open`,
      userIds: recipients,
      message: 'hrChangeChecklist',
      params: {
        name: checklist.employeeName,
        count: String(
          checklist.items.filter((i) => i.status === 'todo').length,
        ),
      },
      path: `/talent/checklists/${checklist.id}`,
    });
  }

  function dueOf(kind: ChecklistKind, effectiveDate: string): string | null {
    if (!effectiveDate) return null;
    if (kind === 'onboard') return addDays(effectiveDate, -1);
    if (kind === 'offboard') return effectiveDate;
    return addDays(effectiveDate, 3);
  }

  const service = {
    register(provider: ChecklistProvider): () => void {
      providers.push(provider);
      return () => {
        const index = providers.indexOf(provider);
        if (index >= 0) providers.splice(index, 1);
      };
    },

    get,

    /** Brings an action's checklist in line with the action's state. Safe to call repeatedly. */
    async syncAction(
      actionId: string,
      settings: { change: boolean; onboard: boolean; offboard: boolean },
    ) {
      const action = await loadAction(actionId);
      if (!action) return undefined;
      const kind = kindOfAction(action.actionType);
      if (!kind || !settings[kind]) return undefined;
      const existing = await findBy('actionId', action.id);
      if (action.status === 'rejected' || action.status === 'cancelled') {
        if (existing && existing.stage !== 'cancelled') {
          await database
            .query()
            .updateTable('jobChangeChecklists')
            .set({ stage: 'cancelled', updatedAt: new Date() })
            .where('id', '=', existing.id)
            .execute();
          await database
            .query()
            .updateTable('workItems')
            .set({ status: 'done', doneAt: new Date(), updatedAt: new Date() })
            .where('refId', '=', `checklist:${existing.id}:open`)
            .where('status', '=', 'open')
            .execute();
        }
        return get(existing?.id ?? '');
      }
      const effective = action.status === 'effective';
      const pendingOrApproved =
        action.status === 'pending' || action.status === 'approved';
      const stage: 'preview' | 'open' | null =
        kind === 'change'
          ? effective
            ? 'open'
            : pendingOrApproved
              ? 'preview'
              : null
          : effective || action.status === 'approved'
            ? 'open'
            : null;
      if (!stage) return existing;
      if (
        existing &&
        (existing.stage === 'done' || existing.stage === 'cancelled')
      )
        return existing;
      const employee = await loadEmployee(action.employeeId);
      const items = merge(
        existing?.items ?? [],
        await compute({
          kind,
          stage,
          effective,
          action,
          event: null,
          employee,
        }),
      );
      const { checklist, changed, opened } = await write(existing, {
        employeeId: employee?.id ?? action.employeeId,
        employeeName: employee?.name ?? str(action.candidate.name ?? '') ?? '',
        kind,
        actionId: action.id,
        jobEventId: existing?.jobEventId ?? null,
        stage,
        items,
        dueDate: dueOf(kind, action.effectiveDate),
      });
      await announce(checklist, opened, changed);
      return checklist;
    },

    /** A job event: refreshes the action's checklist, or opens one for a sync-produced change. */
    async onJobEvent(
      event: JobEvent,
      settings: { change: boolean; onboard: boolean; offboard: boolean },
    ) {
      if (event.actionId) return service.syncAction(event.actionId, settings);
      if (event.source !== 'sync') return undefined;
      const kind: ChecklistKind | null =
        event.eventType === 'transfer' || event.eventType === 'promote'
          ? 'change'
          : event.eventType === 'offboard'
            ? 'offboard'
            : null;
      if (!kind || !settings[kind]) return undefined;
      const existing = await findBy('jobEventId', event.id);
      if (existing) return existing;
      const employee = await loadEmployee(event.employeeId);
      const items = await compute({
        kind,
        stage: 'open',
        effective: true,
        action: null,
        event,
        employee,
      });
      const { checklist, changed, opened } = await write(undefined, {
        employeeId: event.employeeId,
        employeeName: employee?.name ?? '',
        kind,
        actionId: null,
        jobEventId: event.id,
        stage: 'open',
        items,
        dueDate: dueOf(kind, event.effectiveDate),
      });
      await announce(checklist, opened, changed);
      return checklist;
    },

    /** Who may read a checklist: HR administrators, its owner, and — for a preview — the action's current approver. */
    async read(ctx: ActorContext, id: string): Promise<Checklist> {
      const checklist = await get(id);
      if (!checklist) throw new HrError('NOT_FOUND', 404);
      if (await deps.isHrAdmin(ctx)) return checklist;
      if (checklist.ownerUserId === ctx.userId) return checklist;
      if (checklist.actionId) {
        const row = await database
          .query()
          .selectFrom('personnelActions')
          .select(['approvals', 'status'])
          .where('id', '=', checklist.actionId)
          .executeTakeFirst();
        // The level being decided, from the chain snapshot (older rows carry only approverUserId).
        const step = parseJson<
          {
            status: string;
            approverUserId?: string | null;
            approverUserIds?: string[];
          }[]
        >(row?.approvals, []).find((s) => s.status === 'pending');
        const approvers = step
          ? step.approverUserIds?.length
            ? step.approverUserIds
            : step.approverUserId
              ? [step.approverUserId]
              : []
          : [];
        if (row?.status === 'pending' && approvers.includes(ctx.userId))
          return checklist;
      }
      throw new HrError('NOT_FOUND', 404);
    },

    async forAction(
      ctx: ActorContext,
      actionId: string,
    ): Promise<Checklist | null> {
      const checklist = await findBy('actionId', actionId);
      if (!checklist || checklist.stage === 'cancelled') return null;
      return service.read(ctx, checklist.id).catch(() => null);
    },

    async list(ctx: ActorContext, stage?: string) {
      if (!(await deps.isHrAdmin(ctx))) throw new HrError('FORBIDDEN', 403);
      let query = database
        .query()
        .selectFrom('jobChangeChecklists')
        .selectAll()
        .where('stage', '!=', 'preview');
      if (stage && (CHECKLIST_STAGES as readonly string[]).includes(stage))
        query = query.where('stage', '=', stage);
      const rows = await query
        .orderBy('updatedAt', 'desc')
        .limit(200)
        .execute();
      return rows.map((row: Record<string, unknown>) => toChecklist(row));
    },

    /** Marks an item handled, not needed, or back to be done. */
    async handle(ctx: ActorContext, id: string, key: string, input: unknown) {
      const parsed = handleSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const checklist = await service.read(ctx, id);
      const owner =
        checklist.ownerUserId === ctx.userId || (await deps.isHrAdmin(ctx));
      if (!owner || checklist.stage !== 'open')
        throw new HrError('CHECKLIST_NOT_OPEN', 409);
      const item = checklist.items.find((i) => i.key === key);
      if (!item) throw new HrError('NOT_FOUND', 404);
      if (item.status === 'auto') throw new HrError('CHECKLIST_ITEM_AUTO', 409);
      if (parsed.data.status === 'notNeeded' && !parsed.data.note)
        throw new HrError('CHECKLIST_NOTE_REQUIRED', 400);
      const stamp = new Date().toISOString();
      const items = checklist.items.map((i) =>
        i.key === key
          ? {
              ...i,
              status: parsed.data.status,
              note: parsed.data.note,
              handledBy: parsed.data.status === 'todo' ? null : ctx.userId,
              handledAt: parsed.data.status === 'todo' ? null : stamp,
            }
          : i,
      );
      const done = items.every((i) => i.status !== 'todo');
      await database
        .query()
        .updateTable('jobChangeChecklists')
        .set({
          items: JSON.stringify(items),
          itemsHash: hashItems(items),
          stage: done ? 'done' : 'open',
          doneAt: done ? new Date() : null,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      if (done)
        await database
          .query()
          .updateTable('workItems')
          .set({ status: 'done', doneAt: new Date(), updatedAt: new Date() })
          .where('refId', '=', `checklist:${id}:open`)
          .where('status', '=', 'open')
          .execute();
      return (await get(id))!;
    },

    /** Performs an item's own action (adopting the suggested manager), then marks it handled. */
    async perform(ctx: ActorContext, id: string, key: string) {
      const checklist = await service.read(ctx, id);
      const item = checklist.items.find((i) => i.key === key);
      if (!item?.action || !checklist.employeeId)
        throw new HrError('NOT_FOUND', 404);
      if (checklist.stage !== 'open')
        throw new HrError('CHECKLIST_NOT_OPEN', 409);
      if (item.action.type === 'adoptManager')
        await deps.setManager(
          ctx,
          checklist.employeeId,
          item.action.employeeId,
        );
      return service.handle(ctx, id, key, { status: 'done', note: null });
    },

    /** The HR assistant's words. Only text: items and states are untouched. */
    async saveNotes(
      id: string,
      notes: { summary: string; items: Record<string, string> },
    ) {
      const checklist = await get(id);
      if (!checklist) return;
      const items = checklist.items.map((i) => ({
        ...i,
        aiNote: notes.items[i.key]?.slice(0, 200) ?? i.aiNote,
      }));
      await database
        .query()
        .updateTable('jobChangeChecklists')
        .set({
          aiSummary: notes.summary.slice(0, 800),
          items: JSON.stringify(items),
          notesHash: hashItems(checklist.items),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
    },

    /** Whether the notes are behind the items (the task skips when they are not). */
    async notesStale(id: string): Promise<boolean> {
      const row = await database
        .query()
        .selectFrom('jobChangeChecklists')
        .select(['itemsHash', 'notesHash', 'stage'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row || row.stage === 'cancelled') return false;
      return str(row.itemsHash ?? '') !== str(row.notesHash ?? '');
    },

    /** Daily: open checklists past their due date with items left get one reminder per interval. */
    async remindOverdue(intervalDays: number) {
      const date = today(deps.timeZone);
      const rows = await database
        .query()
        .selectFrom('jobChangeChecklists')
        .selectAll()
        .where('stage', '=', 'open')
        .execute();
      let sent = 0;
      for (const row of rows) {
        const checklist = toChecklist(row);
        if (!checklist.dueDate || checklist.dueDate >= date) continue;
        const left = checklist.items.filter((i) => i.status === 'todo').length;
        if (!left) continue;
        const days = Math.floor(
          (Date.parse(`${date}T00:00:00Z`) -
            Date.parse(`${checklist.dueDate}T00:00:00Z`)) /
            86400000,
        );
        if (days % Math.max(1, intervalDays) !== 0) continue;
        await deps.notify({
          key: `checklist:${checklist.id}:overdue:${date}`,
          userIds: checklist.ownerUserId
            ? [checklist.ownerUserId]
            : await deps.owners(),
          message: 'hrChangeChecklistOverdue',
          params: { name: checklist.employeeName, count: String(left) },
          path: `/talent/checklists/${checklist.id}`,
        });
        sent += 1;
      }
      return sent;
    },
  };
  return service;
}

export type ChecklistService = ReturnType<typeof createChecklistService>;
