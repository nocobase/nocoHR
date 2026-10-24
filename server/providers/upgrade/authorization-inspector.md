# Role revocation and authorization inspector

Restricted authorization managers can revoke role assignments using the target service's existing `assign` action. The original inspector route is restored with its existing `settings:authorization.inspector/inspect` requirement. This client unit keeps the application undeployable draft boundary: retired packages, the real application lock and complete startup remain unresolved.

## Preserved behavior and source

- Assignment deletion checks `assign` for the caller and independently respects the role's `protection.allow` entry for `revoke`. No server action, unrestricted identity, schema or migration is added.
- `/settings/authorization/inspector` is a lazy Settings contribution. The original `?user=` shortcut, explicit subject parameters, selected catalogue section, resource search, configured-only filter and pagination remain URL-owned.
- The resource/action matrix, decision markers, reasons, direct/inherited grant sources, record scopes, field lists, nested composite decisions and technical details are retained from the official `nocobase/nocobase3@6f38530` inspector presentation. Only its dependency closure is added under the application page folder; private package imports are replaced with public native client contracts, application primitives and page-local presentation types.
- The application supplies its human page titles and stable page grant IDs to the inspector catalogue. No sample capability or production subject is registered.
- Application PageContainer/PageHeader and the existing Sheet replace the old plugin chrome. Consumed English/Chinese messages live in application-owned locale modules; native catalogue title descriptors retain their owning namespaces.
- Options survive subject changes. Subject-owned results remount when query identity changes, invalidating all pending configured, batch, directory and detail responses. Permission snapshot invalidation removes the workspace and detail portal before another identity can reuse them.
- Cell details recheck through native `inspect`; the matrix uses `inspectBatch` in chunks of at most 100, and configured shields use `inspectConfigured`. A configured-access refusal remains visible when a concurrent batch succeeds. Inspection never performs the underlying action.

## Validation and trust boundary

The current client selection passes 206 tests across 34 files (the three exhaustive page-loader checks run separately from 203 component/contract checks). Scoped client/component and native authorization-test types, changed-file lint/format and preservation checks pass.

- The assignment component now uses `unrestricted: false` with exactly the native `read` and `assign` actions. It fails before the fix and passes after it. Read-only callers have no mutation controls; an assignable role that disallows revoke still hides deletion.
- A separate SQLite fixture loads the published target authorization migrations through its real migrator and constructs `createAppAuthorization`. The real registered catalogue, Permission Set store, request contexts and HTTP route handlers enforce supported actions, successful deletion, no-permission denial and role protection.
- Native inspector handlers test allowed/denied page decisions, two-check batching, configured grants and sources, subject directories and unauthorized callers. Session authentication is replaced by explicit synthetic request contexts; this is not complete application login acceptance.
- Component tests run the real AuthorizationClient with synthetic responses. They cover both languages, field restrictions and grant-source detail, a manager without inspect permission, native refusals, a concurrent configured/batch refusal, late configured/batch/detail responses after subject changes, and permission withdrawal with an open detail portal.
- Existing client route and component regressions remain. The workflow is a quick preservation refactor of the original page; no new visual design or backend interaction model is introduced.

## Request and database cost

The permission fix reuses the existing `assign` decision and adds no request or persistence. The inspector adds no poller, recurring timer, business action, lock or transaction of its own. A cold page reads the native permission snapshot and options once; selected subjects read configured access and batch decisions. Collection directories retain pages of 30 and the existing 200 ms input debounce. Subject names resolve in batches of at most 100 per collection type, with another pass when inherited identities/sources arrive. Opening a cell sends one fresh decision request; explicit refresh repeats configured/batch reads. Subject changes reuse options.

The following are actual SQLite samples from the isolated native fixture, excluding migration/setup and session discovery. Each request creates a fresh native authorization context. These are examples, not universal production query counts.

| Native request                                 | SELECT | Write statements | Transactions |
| ---------------------------------------------- | -----: | ---------------: | -----------: |
| Inspector options                              |      2 |                0 |            0 |
| One allowed page decision                      |      4 |                0 |            0 |
| Batch of two page decisions                    |      4 |                0 |            0 |
| Configured access for one assigned user        |      5 |                0 |            0 |
| Synthetic user directory                       |      2 |                0 |            0 |
| Each unauthorized inspector request            |      2 |                0 |            0 |
| Assignment deletion without assign             |      2 |                0 |            0 |
| Assignment deletion blocked by role protection |      3 |                0 |            0 |
| Explicit permitted assignment deletion         |     19 |                2 |            1 |

The ten-request inspector sample totals 27 SELECT and zero writes. Its directory provider is synthetic and performs no database lookup. Native assignment writes and transaction are existing service behavior, not added by the UI fix. Full application/session/HR SQL and real directory cost remain unmeasured.

## Remaining gates and reproduction

Both replacement runtime entries and device authorization stay closed. All old registrations, historical migrations, dependency declarations and the original application lock remain. Other authorization-rule, scheduler/notification and replacement-management surfaces remain subsequent units. Deployed inventories, original compiled migration/manifest/checksum archives, cookie/session and encrypted-key conversion, and final compatible dependency installation still gate cutover.

The evidence package pins the public tooling lock, upstream presentation sources, before/after revocation logs, native SQL samples and portable validation scripts. Use its separate tooling installation and the existing client verification script; never copy that lock into the application. Full application build and strict source startup still fail during the retained AI CLI import, so no running-application English screenshots or complete browser/login/migration acceptance are available. No deployment or original database is accessed.
