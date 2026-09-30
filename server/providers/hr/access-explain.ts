/**
 * V1-02 权限说明: answers "why can / can't X see Y" with the facts the
 * authorization plugin already decides on — the subjects the user resolves
 * to (user, department, department head, position), the permission sets
 * assigned to them, and whether the employee record is readable in that
 * user's scope. Read-only: nothing here assigns or removes anything.
 *
 * An HR administrator may ask about anyone; anyone else only about
 * themselves, and only about employees they could look up anyway.
 */
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseManager } from '@nocobase/db';

import { scopeForUser } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { OrganizationService } from './organization-service.js';
import type { TalentService } from './talent-service.js';
import { HrError, str } from './shared.js';

export interface AccessExplanation {
  viewer: {
    name: string;
    department: string | null;
    position: string | null;
    heads: string[];
  };
  subjects: { type: string; label: string }[];
  permissionSets: { key: string; title: string; via: string[] }[];
  employee?: {
    name: string;
    department: string;
    /** Who manages the employee's department (up the tree when it has no head). */
    departmentHead: string | null;
    viewerCanView: boolean;
    viewerCanViewSensitive: boolean;
  };
  hints: string[];
}

export function createAccessExplainer(deps: {
  database: DatabaseManager;
  authz: AppAuthorization;
  organization: OrganizationService;
  talent: () => TalentService;
  isHrAdmin: (ctx: ActorContext) => Promise<boolean>;
}) {
  const { database, authz, organization } = deps;

  async function findEmployee(ref: string) {
    const rows = await database
      .query()
      .selectFrom('employees')
      .select([
        'id',
        'name',
        'userId',
        'departmentId',
        'positionId',
        'employeeNo',
      ])
      .where((eb) => eb.or([eb('name', '=', ref), eb('employeeNo', '=', ref)]))
      .execute();
    if (rows.length > 1)
      throw new HrError('ACCESS_EXPLAIN_AMBIGUOUS', 400, { ref });
    return rows[0];
  }

  async function titleOf(departmentId: string | null) {
    if (!departmentId) return null;
    const department = await organization.getDepartment(departmentId);
    return department ? organization.titleText(department.title) : departmentId;
  }

  async function positionOf(positionId: unknown) {
    if (positionId == null) return null;
    const row = await database
      .query()
      .selectFrom('positions')
      .select(['title'])
      .where('id', '=', str(positionId))
      .executeTakeFirst();
    return row ? str(row.title) : null;
  }

  return {
    async explain(
      ctx: ActorContext,
      input: { user?: string; employee?: string },
    ): Promise<AccessExplanation> {
      const admin = await deps.isHrAdmin(ctx);
      let viewerUserId = ctx.userId;
      if (input.user) {
        const viewer = await findEmployee(input.user);
        if (!viewer?.userId)
          throw new HrError('ACCESS_EXPLAIN_USER_UNKNOWN', 404);
        if (str(viewer.userId) !== ctx.userId && !admin)
          throw new HrError('ACCESS_EXPLAIN_SELF_ONLY', 403);
        viewerUserId = str(viewer.userId);
      }
      const viewerEmployee = await database
        .query()
        .selectFrom('employees')
        .select(['name', 'departmentId', 'positionId'])
        .where('userId', '=', viewerUserId)
        .executeTakeFirst();
      const subjects = await authz.subjects.resolveFor({
        type: 'user',
        id: viewerUserId,
      });
      const labels: { type: string; id: string; label: string }[] = [];
      for (const subject of subjects) {
        if (
          subject.type === 'org.department' ||
          subject.type === 'org.departmentHead'
        )
          labels.push({
            type: subject.type,
            id: subject.id,
            label: (await titleOf(subject.id)) ?? subject.id,
          });
        else if (subject.type === 'org.position')
          labels.push({
            type: subject.type,
            id: subject.id,
            label: (await positionOf(subject.id)) ?? subject.id,
          });
        else if (subject.type === 'user')
          labels.push({
            type: 'user',
            id: subject.id,
            label: str(viewerEmployee?.name ?? subject.id),
          });
      }
      const permissionSets: AccessExplanation['permissionSets'] = [];
      for (const set of await authz.permissionSets.list()) {
        const via: string[] = [];
        for (const assignment of await authz.permissionSets.listAssignments(
          set.key,
        )) {
          const hit = labels.find(
            (l) =>
              l.type === assignment.subject.type &&
              (assignment.subject.id === '*' || l.id === assignment.subject.id),
          );
          if (hit) via.push(`${hit.type}:${hit.label}`);
          else if (
            assignment.subject.type === 'org.departmentHead' &&
            assignment.subject.id === '*' &&
            labels.some((l) => l.type === 'org.departmentHead')
          )
            via.push('org.departmentHead:*');
        }
        if (via.length)
          permissionSets.push({
            key: set.key,
            title: typeof set.title === 'string' ? set.title : set.key,
            via: [...new Set(via)],
          });
      }
      const heads = labels
        .filter((l) => l.type === 'org.departmentHead')
        .map((l) => l.label);
      const result: AccessExplanation = {
        viewer: {
          name: str(viewerEmployee?.name ?? ''),
          department: await titleOf(
            viewerEmployee?.departmentId == null
              ? null
              : str(viewerEmployee.departmentId),
          ),
          position: await positionOf(viewerEmployee?.positionId),
          heads,
        },
        subjects: labels.map(({ type, label }) => ({ type, label })),
        permissionSets,
        hints: [],
      };
      if (input.employee) {
        // Department and department head are what the org chart shows everyone; nothing more is revealed.
        const target = await findEmployee(input.employee);
        if (!target) throw new HrError('ACCESS_EXPLAIN_EMPLOYEE_UNKNOWN', 404);
        const head = await organization.resolveHead(str(target.departmentId));
        const headName = head
          ? await database
              .query()
              .selectFrom('employees')
              .select(['name'])
              .where('userId', '=', head.userId)
              .executeTakeFirst()
          : undefined;
        const access = await canView(viewerUserId, str(target.id));
        result.employee = {
          name: str(target.name),
          department: (await titleOf(str(target.departmentId))) ?? '',
          departmentHead: headName ? str(headName.name) : null,
          viewerCanView: access.view,
          viewerCanViewSensitive: access.sensitive,
        };
        if (!access.view)
          result.hints.push(heads.length ? 'managerScope' : 'noManagerScope');
      }
      return result;
    },
  };

  async function canView(userId: string, employeeId: string) {
    const scoped = { userId, authz: await scopeForUser(authz, userId) };
    const detail = await deps
      .talent()
      .getEmployee(scoped, employeeId)
      .catch(() => undefined);
    return {
      view: Boolean(detail),
      sensitive: Boolean(detail?.can.viewSensitive),
    };
  }
}

export type AccessExplainer = ReturnType<typeof createAccessExplainer>;
