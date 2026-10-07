/**
 * The record scope and readable fields a payroll action's grant carries.
 *
 * The payroll services read with the query builder (joins, month windows,
 * in-memory history), so they cannot bind each read to a Repository policy.
 * Instead every service resolves the policies of the action it authorized
 * and passes its rows through these scopes: a row is read only when its
 * collection's policy selects it and, for a row about an employee, the
 * employee is in the action's `employees` scope; a field the grant does not
 * list is left out. Under the default all-records grants nothing is filtered
 * and no extra query runs, so the behaviour is unchanged; an administrator
 * who limits 薪酬专员 to some departments, or a grant that leaves out
 * `bankAccount` or `idNumber`, now takes effect.
 */
import type { DatabaseManager, RepositoryPolicy } from '@nocobase/db';

import { policyOf, type CollectionPolicies } from '../authorize.js';
import { HrError, str } from '../shared.js';

export interface ReadScope {
  /** The policy selects every row of the collection. */
  readonly all: boolean;
  /** Whether the row with this id is in scope. */
  has(id: unknown): boolean;
  /** Whether the grant lets this field be read. */
  readable(field: string): boolean;
}

const EVERYTHING: ReadScope = {
  all: true,
  has: () => true,
  readable: () => true,
};

/** The read scope of one collection under an action's policies. */
export async function readScope(
  database: DatabaseManager,
  policies: CollectionPolicies,
  collection: string,
): Promise<ReadScope> {
  const policy: RepositoryPolicy = policyOf(policies, collection);
  const read = policy.read;
  if (read === true) return EVERYTHING;
  if (read === false) throw new HrError('FORBIDDEN', 403);
  const fields =
    read.fields === undefined || (read.fields && read.fields.includes('*'))
      ? null
      : new Set(read.fields === false ? [] : read.fields);
  const readable = (field: string) => !fields || fields.has(field);
  if (read.scope === true) return { all: true, has: () => true, readable };
  const rows = (await database
    .repository(collection)
    .withPolicy(policy)
    .findMany({})) as Record<string, unknown>[];
  const ids = new Set(rows.map((row) => str(row.id)));
  return {
    all: false,
    has: (id) => id !== null && id !== undefined && ids.has(str(id)),
    readable,
  };
}

export interface PayrollScopes {
  /** Whether the action grants this collection at all. */
  grants(collection: string): boolean;
  /** The scope of a collection the action grants (FORBIDDEN when it grants none). */
  of(collection: string): Promise<ReadScope>;
  /** Whether the action reaches this employee. */
  employee(employeeId: unknown): Promise<boolean>;
  /**
   * Keeps the rows of `collection` in scope: the row itself, and — unless the
   * action grants no employees — the employee the row is about.
   */
  rows<T extends { id?: unknown; employeeId?: unknown }>(
    collection: string,
    rows: readonly T[],
  ): Promise<T[]>;
  /** Copies a row with the fields the grant does not list left out. */
  fields<T extends Record<string, unknown>>(
    collection: string,
    row: T,
  ): Promise<T>;
}

export function payrollScopes(
  database: DatabaseManager,
  policies: CollectionPolicies,
): PayrollScopes {
  const cache = new Map<string, Promise<ReadScope>>();
  const of = (collection: string) => {
    let scope = cache.get(collection);
    if (!scope) {
      scope = readScope(database, policies, collection);
      cache.set(collection, scope);
    }
    return scope;
  };
  const employees = () =>
    policies.employees ? of('employees') : Promise.resolve(EVERYTHING);
  return {
    grants: (collection) => Boolean(policies[collection]),
    of,
    async employee(employeeId) {
      return (await employees()).has(employeeId);
    },
    async rows(collection, rows) {
      const scope = await of(collection);
      const people = await employees();
      if (scope.all && people.all) return [...rows];
      return rows.filter(
        (row) =>
          scope.has(row.id) &&
          (row.employeeId === undefined || people.has(row.employeeId)),
      );
    },
    async fields(collection, row) {
      const scope = await of(collection);
      if (scope === EVERYTHING) return row;
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row))
        if (scope.readable(key)) copy[key] = value;
      return copy as typeof row;
    },
  };
}
