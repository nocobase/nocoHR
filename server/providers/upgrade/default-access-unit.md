# Default access management

The original default-access Settings page is restored at `/settings/authorization/default-access` and uses the public `@nocobase/app-plugin-authz-default-access` service. The route keeps the existing `settings:authorization.default-access/read` page grant. Page access and each mutation are also checked against the target service; the UI never grants an action or field permission.

## Behavior and preservation

- Options and rules use the target service. The page shows the full registered resource matrix, including resources without a saved rule, with section/group/search/configured filters and URL-backed paging.
- Simple actions save their selected scope immediately; specific filters, record selections and composite resources use the existing drawer. Composite action/scope pairs retain their `scopeKey` and unrelated actions.
- Opening an editor rereads the rule. Before saving an edit, the client rereads the rule and compares every action/scope token with the editor's baseline; any intervening action/scope change rejects the save. It does not merge concurrent changes, and this GET-before-PATCH check is not an atomic version lock. A successful POST or PATCH is followed by a rule-list reload before showing success. Clearing is confirmed by resource name and uses DELETE.
- Read-only identities see rules without mutation controls. Create, update and delete controls follow their matching settings permission. Reserved endpoint keys cannot be created or edited. A 403 clears the current work area and invalidates the authorization snapshot; request generations and unmount cleanup discard late results.
- User-facing text is application-owned in both locale modules. No migration, server route, additional permission or plugin registration was added. The role revocation, inspector, old registrations, historic migration sources, closed replacement entries, and application lockfile remain unchanged.

## Verification and limits

The focused verification passed 17 tests across the default-access component, native authorization service, management route, and page-permission-title suites. Component tests cover read-only controls, direct navigation without read access, collection-specific record-access choices, record search and paging, field-validation failures shown beside the affected scope while preserving the draft, success followed by reread, and a late list response after read access is withdrawn. Route coverage pins the original path and permission.

The SQLite service fixture loads the published authorization `.28` and default-access `.13` migrations with the native migrator, target plugin, catalogue, permission sets, and HTTP handlers. Synthetic restricted identities cover options/list/record reads, read/create/update/delete separately, unauthorized and read-only denials, validation errors, successful create/update/delete, and reserved keys. Component identity and API responses are synthetic; this is not full application login or HR authorization acceptance.

The component/service/route tests, affected client and native type subsets, the new component-test type check, scoped lint, formatting, and diff checks passed. Build, strict application startup, complete login/HR permissions, browser acceptance, PostgreSQL and the English running-app screenshot remain unverified: the complete application is still blocked by the retained AI CLI import and incompatible dependency graph, documented in [template integration](template-integration.md). No deployment or original database was accessed.

## Measured native request cost

Counts are from the isolated SQLite target-service fixture, excluding migration/setup. Each row is a separate native handler request; all default-access samples ran without a transaction.

| Operation                               | SELECT | Writes |
| --------------------------------------- | -----: | -----: |
| Read options with permission            |     12 |      0 |
| Read one record page with permission    |      9 |      0 |
| Read one record page without permission |      2 |      0 |
| Valid restricted create                 |      9 |      1 |
| Invalid or reserved-key create          |      2 |      0 |
| Read/list with permission               |      3 |      0 |
| Read/list without permission            |      2 |      0 |
| Read-only create or update denial       |      2 |      0 |
| Restricted update                       |      4 |      1 |
| Restricted delete                       |      3 |      1 |

These are fixture observations, not production query guarantees. Session discovery, real subject directories and HR queries are outside this sample. The page adds no poller or background request; a successful edit adds one pre-save list read and one confirming list read around the target mutation.

## Reproduction

With the approved isolated target tooling available to the checkout, run:

```sh
node node_modules/vitest/vitest.mjs run tests/components/default-access.test.tsx tests/logic/authorization-management.test.ts tests/logic/client-management-routes.test.ts tests/logic/page-permission-titles.test.ts --reporter=dot
```

Run the targeted client/native type scripts and scoped lint/format check used for this change. The tooling lock lives outside the application and must not replace `pnpm-lock.yaml`. This unit was verified against template `.70` / Skills `.38`; the fixed target is now `.74` / `.42` as recorded in [integration status](template-integration.md). Target adaptation and lockfile cutover remain pending.
