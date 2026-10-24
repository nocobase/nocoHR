# Sharing rules management unit

The application now restores its own Sharing rules page at `/settings/authorization/sharing-rules`. It uses the target public service in `@nocobase/app-plugin-authz-sharing-rules@1.0.0-beta.13`, whose Settings item is `authorization.sharing-rules` with separate `read`, `create`, `update` and `delete` actions. The page contributes no server route or permission and does not enable or register another runtime.

## User-visible behavior

- The page lists the full rule set returned by `GET /api/authorization/sharingRules`. The target endpoint returns `meta.total` but has no search or paging parameters, so name/key/resource/subject/action search and resource-group filtering run in the browser and are stored in `q` and `group` URL parameters. Subject and record directories use their target paged endpoints; the record endpoint has no search parameter.
- New and edit forms read options and the rule list through the target API. The resource/action/scope options come from the target catalogue. Composite actions keep each `scopeKey`; a record selection or a registered record-access selection is sent with its collection-bound scope. The UI does not offer an all-record selection. Unsupported saved actions or policies are visible and retained until the administrator deliberately removes or replaces them.
- Subject lookup uses the target subject directory and resolves names through the target client. Changing subject type invalidates older requests. The record picker keeps selected ids while paging.
- Create uses `POST`; edit sends a `PATCH` containing only changed fields; delete is confirmed before `DELETE`. Successful mutations reread the list before the page reports success. A failed save keeps the draft. Read, create, update and delete controls use their matching `useCan` action, while the target server still authorizes every request.
- Before an edit PATCH, the page rereads the current list and compares every field in the outgoing patch to the editor's baseline. A change to a field that this editor is also changing is rejected for an explicit reload. Fields not in the PATCH remain owned by the latest server record. This pre-read is not an atomic version check: another edit between GET and PATCH can still race, because the target route exposes no revision precondition.
- A sharing rule adds records only to an action its subjects already have. It grants no action, page, field or related-record access, and restriction rules still narrow the result. The page description and form repeat this limit.
- A 403 clears the current data and invalidates the authorization snapshot; request generations and cleanup discard stale responses. Resource changes and deletes use confirmation dialogs. Dirty forms use the application's leave guard.

## Target and preservation decisions

The route and Settings id match the target package contract. The original NocoHR Settings surface and its permission model remain intact. This unit adds only client routes, client copy, a route regression and two test suites. It adds no dependency, server route, permission, plugin registration, database migration, data rewrite or application lockfile change.

The list endpoint returns all rules, so the page deliberately has no rule-table paginator. It also does not invent server-side record search where the target API has no search parameter. Subject and record selection are paged at 20 rows. Existing composite scopes and all unedited fields are preserved by the current rule payload or by partial PATCH. If a saved option has disappeared from the current catalogue, the page displays it without silently dropping it; the target service remains the authority for whether a new change is valid.

The default-access unit's earlier concurrency description was also corrected: it checks every action/scope token before PATCH, rejects any intervening change, does not merge changes, and does not obtain an atomic GET/PATCH lock.

## Verification

The focused component tests use the target `AuthorizationClient` and synthetic HTTP responses. They cover read-only and no-read identities, creation and post-save reload, IME input, row overflow, same-field conflict rejection, a title-only partial PATCH, preservation of a second composite scope and its `scopeKey`/custom filter while another scope changes, save failure and draft retention, subject-type stale responses, update revocation, delete confirmation/cancellation, and focus after closing or deleting.

The native service tests load the published target Authorization and Sharing rules migrations into an isolated in-memory SQLite database, register the actual target plugin factory and route handlers, then use restricted authorization contexts. They cover permitted read/create/update/delete actions, read-only and no-permission denials, invalid all-record selection and duplicate subjects, and zero writes on denied or invalid mutations. Identities, subject directory, records and business data are synthetic; this is not full application login or HR permission acceptance.

Re-run the focused suites with the approved isolated public tooling environment linked as `node_modules`:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/components/sharing-rules.test.tsx \
  tests/logic/sharing-rules-management.test.ts \
  tests/logic/client-management-routes.test.ts \
  tests/logic/page-permission-titles.test.ts --reporter=dot
```

Also run the scoped client and native type checks, ESLint, Prettier and `git diff --check` for this unit's changed files. The isolated tooling lock is verification-only and cannot replace the application lock.

## Measured native request cost

Counts below were measured by tracing the target handlers in the isolated SQLite fixture after migration setup. One request is listed per row. `Writes` counts SQL INSERT/UPDATE/DELETE statements; `Tx` counts transaction begins. These samples exclude application bootstrap, session resolution, real subject directories, HR queries and production data size.

| Request                                   | SELECT | Writes |  Tx |
| ----------------------------------------- | -----: | -----: | --: |
| Allowed rule list                         |      9 |      0 |   0 |
| Options                                   |     12 |      0 |   0 |
| Subject directory page                    |      2 |      0 |   0 |
| Record directory page                     |      9 |      0 |   0 |
| Allowed create                            |     18 |      2 |   1 |
| Allowed update                            |     15 |      3 |   1 |
| Allowed delete                            |     15 |      2 |   1 |
| Read-only create or update denial         |      2 |      0 |   0 |
| No-grant read/create/update/delete denial |      1 |      0 |   0 |
| Invalid all-record rule                   |      8 |      0 |   0 |
| Duplicate-subject rule                    |      2 |      0 |   0 |

The list page adds no background polling or scheduler. A successful mutation is followed by a list/options reload. An edit also does one list read immediately before PATCH to detect stale fields, but that read and PATCH are not atomic.

## Remaining integration boundary

The application template marker remains `.54`; the approved source target remains template `.70` with Skills `.38`. The original application lockfile, old AI/Workflow registrations and historical migration sources are unchanged. Both replacement runtime entries and device authorization remain closed. The complete app dependency graph is still incompatible and the known strict startup failure occurs at the retained AI CLI import. This unit was checked with component and native service tests; complete login/HR authorization, full application build/start, real browser acceptance, PostgreSQL and English running-application screenshots remain for integration acceptance. No deployment or original database was used.
