# Restriction rules management unit

This unit restores the application-owned Settings page at `/settings/authorization/restriction-rules` and connects it to the published `@nocobase/app-plugin-authz-restriction-rules@1.0.0-beta.12` service. The existing Settings resource is `authorization.restriction-rules`; the route and controls use its separate `read`, `create`, `update` and `delete` actions. The plugin remains registered as it was. This unit adds no server route, permission, migration, seed, background process or concurrency protocol.

## User-visible behavior

- The page reads `GET /api/authorization/restrictionRules` and the target authorization options. The rule list endpoint returns the full list and has no search or page parameters, so search and resource-group filtering run in the browser and remain in the `q` and `group` URL parameters. Subject and record directories use their native paged endpoints (20 items per page in this UI).
- Create, edit, and delete use the target `POST`, `PATCH` and `DELETE` actions. Delete is confirmed. A successful mutation rereads the list before the page reports success. A failed save keeps the draft and does not show private server details.
- A rule selects the records that remain allowed for its subjects. It only narrows access already granted by the other authorization sources; it never grants an action or widens access. An explicit `all` selection means this rule leaves other sources unchanged. Composite action `scopeKey` values and registered record-access parameters are preserved.
- The form retains a resource, action or record-access selection that has disappeared from the current options until an administrator deliberately changes or removes it. An edit sends only changed fields, preserving fields not in the patch. Before a patch, it rereads the latest rule and rejects a concurrent change to a field this edit also changes. The pre-read and PATCH are not atomic; the target service exposes no revision precondition, and this unit adds no concurrency protocol.
- Resource changes confirm before clearing actions. Record selection keeps chosen IDs across pages. The editor key is based on resource, action and scope identity, not mutable selection, so selecting or removing a record does not reset the current page or make another directory request. Switching action or resource remounts the relevant picker; effect cleanup ignores late responses.
- The page uses `AuthorizationClient` and `useCan` with the existing Settings grants. The target service separately checks every route. A 403 clears rule and directory state and invalidates the authorization snapshot; request generations and effect cleanup prevent stale responses from restoring the old view.

## Target contract and preservation

The UI is adapted to `@nocobase/app-plugin-authz-restriction-rules@1.0.0-beta.12` and `@nocobase/app-plugin-authorization@1.0.0-beta.28`. It uses the published restriction-rules Settings resource and `GET /restrictionRules`, `POST /restrictionRules`, `PATCH /restrictionRules/:key`, `DELETE /restrictionRules/:key`, `GET /restrictionRules/options`, subject directory/resolve endpoints and `GET /restrictionRules/records/:collection`. The target service supports `all`, `records(ids)` and registered `recordAccess` selections; the server validates each write and rejects reserved keys and duplicate subjects.

The application manifest already declares the target package ranges, but the application lock still resolves restriction rules `.7` and authorization `.23`. The isolated verification graph uses the published target packages `.12` and `.28`; it is not the application lock and does not prove that the full application can currently install or run. Reconciling the application dependency graph and lock is an overall template-upgrade gate, so this unit leaves the application lock untouched.

This unit changes only the Settings routes, localized English/Chinese copy, application route/locale regression coverage, page components and focused component/native service tests. It does not alter the old AI/Workflow registrations, migration or seed history (138 files), application package manifest or lock, plugin registration, device authorization, or the disabled replacement entries. The `.54` template marker, `.70` approved target and Skills `.38` remain unchanged.

## Verification

Focused tests use the target `AuthorizationClient` with synthetic API responses and the native target restriction rules handlers with synthetic principals and directory records. They cover restricted create/update/delete actions, read-only and no-grant denials, explicit all-record selection, key-only rename, composite scope preservation, metadata-only edit of an uncatalogued resource, same-field conflict rejection, failed-save draft retention, delete confirmation, multi-page selection and cancellation, action/resource/subject switching with late responses, and permission revocation with a pending directory response. These fixtures are not full application login, HR authorization or browser acceptance.

The native service tests load the target Authorization `.28` and restriction rules `.12` migrations into an isolated in-memory SQLite database, register the target factory and route handlers, and trace SQL. They do not modify application migration sources or access application data.

Run the focused checks from the checkout with the independent public tooling environment available as `node_modules`:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/components/restriction-rules.test.tsx \
  tests/logic/restriction-rules-management.test.ts \
  tests/logic/client-management-routes.test.ts \
  tests/logic/page-permission-titles.test.ts \
  tests/logic/app-locale-coverage.test.ts --reporter=dot
node /tmp/typecheck-restriction.mjs "$PWD" "$TMPDIR"
pnpm exec eslint <changed TypeScript files>
pnpm exec prettier --check <changed files>
git diff --check
```

The run for this unit passed 38 tests across five files, scoped client and native TypeScript checks, ESLint, Prettier and `git diff --check`. The accompanying `restriction-rules-validation.tgz` includes the focused logs, typecheck script, and reproduction notes. Its independent tooling manifest/lock is verification-only and must not replace `pnpm-lock.yaml`.

## Measured native request cost

Counts below are per target handler request after migrations were loaded. `Writes` counts SQL INSERT/UPDATE/DELETE statements; `Tx` counts transaction begins. The sample excludes app bootstrap, real sessions, production subject directories, HR data and real data volume.

| Request                                     | SELECT | Writes |  Tx |
| ------------------------------------------- | -----: | -----: | --: |
| Allowed rule list                           |      9 |      0 |   0 |
| Options                                     |     12 |      0 |   0 |
| Subject directory page                      |      2 |      0 |   0 |
| Record directory page                       |      9 |      0 |   0 |
| Allowed create                              |     18 |      2 |   1 |
| Allowed update                              |     15 |      3 |   1 |
| Allowed delete                              |     15 |      2 |   1 |
| Read-only write denial                      |      2 |      0 |   0 |
| No-grant read/create/update/delete denial   |      1 |      0 |   0 |
| Duplicate-subject or reserved-key rejection |      2 |      0 |   0 |

The cold list page reads the list and options once. The record picker fetches a page when opened or when its collection/page changes; selection changes issue no request. An edit also reads the list before PATCH, then rereads the list after success. There is no new polling, scheduler or background work.

## Remaining integration boundary

Full application installation/build/start, login and HR permission composition, PostgreSQL, real browser refresh, English runtime screenshots and full migration composition remain unverified. The recorded dependency incompatibility and retained old AI CLI import still block the full application flow. The application lock/dependency graph, actual deployment mapping and artifact archive, session and old-key conversion, and end-to-end acceptance remain overall upgrade gates. No deployment or application database was used for this unit.
