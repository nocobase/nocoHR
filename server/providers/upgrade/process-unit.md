# Process execution and retained history

> Current scope, 2026-10-23: the owner confirmed there is no used old environment or existing production data. The older installed-inventory/archive requirements below are historical and are not applicable to this application; they are not passed migration/restore tests. Preserve all 138 source files. New-environment definitions/handlers, actual business behavior, authorization, idempotence, strict installation/build/source-and-build startup and isolated new-database restore remain applicable. This unit's closed runtime/preflight is unchanged.

This unit connects the existing process compiler and durable state to native Jobs and Scheduler, with authorized APIs and explicit terminal-history copying. It is opt-in through `processes.enabled` (default false). Existing plugins, tables, files and historical migration sources remain in place. The application registry is deliberately empty: installed business definitions and handlers still need individual mapping before any switch.

## Verified source and bounded mapping

The old contract is `@nocobase/app-plugin-workflow@1.0.0-beta.32`, checked against [the official published source tree](https://github.com/nocobase/nocobase3/tree/6f38530/packages/plugins/app-plugin-workflow). Its collections, instruction contracts and authorization resource were checked directly. That source is not an archive of the original installed compiled package or migration checksums.

| Source                                                                | Application representation                                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflows`, `workflowNodes`, `workflowStats`, `workflowVersionStats` | A definition snapshot in `processDefinitions`, preserving string IDs, revision hash, metadata and counters; explicit validated artifact hash links it to the reviewed definition. |
| `workflowRuns`, `workflowNodeRuns`                                    | A snapshot in `processRunHistory`, preserving original run/node IDs, inputs, outputs, results, timestamps and terminal statuses. It is never an executable run.                   |
| `run` with a registered module and empty arguments                    | A named application handler; no database-controlled dynamic import.                                                                                                               |
| `condition` with a registered module                                  | A boolean handler and exactly one `yes` and one `no` branch. Branch joins are unsupported.                                                                                        |
| `terminate`                                                           | `success` maps to success, `failure` to failed.                                                                                                                                   |

Module bindings and current definitions/handlers are explicit application source in `server/processes/index.ts`. Native schedule-ID-to-user delegation is explicit server configuration in `processes.scheduleUsers`, defaulting to an empty map. A handler receives the persisted actor, validated input, prior node results and stable event/node idempotency key. Its business service must enforce its own record scope as that actor. The source mapping does not assume that every old module implements this new handler contract.

Copying requires matching enabled state, normalized JSON input schema and complete mapped topology. Nonempty parameters, parameter values, client capabilities, node options, run arguments, unsupported workflow options, unknown instructions or missing handlers/artifacts fail before commit. Only absent timeout or timeout zero is supported. Old queued/started runs block copying. Terminal statuses 1, -1, -2 and -3 are retained; unknown statuses, missing/duplicate node results and wrong revision references block copying. Successful history must contain exactly its successful recorded path, including a boolean condition result and successful terminator where declared.

One unit is one revision, at most 100 terminal runs and 1,000 total node results. Larger units require a separate batching decision. Definitions with unsupported capabilities remain readable under management authorization but cannot be copied into the verified subset. Failed/aborted histories retain their available terminal results; the unit does not reconstruct missing in-flight state.

## Build and runtime paths

`pnpm nocobase app build-processes` compiles the explicit registry to `server/processes/artifacts/`. The application CLI build hook runs the same command after the server build, writing `dist/server/processes/artifacts/`. There is no runtime TypeScript module loader for persisted definitions.

The manifest selects artifact files by digest. Loading checks manifest size/count, real paths, file size, digest, handler availability, topology and JSON input contract before replacing the in-memory catalog. Invalid or absent artifacts fail enabled startup. Empty source manifest is valid only for the currently empty registry. Production packaging and the complete build hook still require full application verification.

`ProcessesProvider` loads that catalog, registers an `app.processes.execute` job with the application's native Jobs service and an `app.process` asynchronous Scheduler target. The target validates `{key, hash, input}`. Its execution user comes from `processes.scheduleUsers[nativeScheduleId]`, never target JSON, a schedule key or an implicit root user. Unbound schedules fail. Configuration validates IDs, rejects unknown fields and limits the map to 1,000 bindings. It is server-only, with no public configuration paths or API to assign users. Each firing reads the current validated configuration; a removed binding or disabled runtime refuses new scheduled acceptance. A previously accepted run retains its saved actor and continues to recheck that actor's current permissions. The service uses the occurrence ID as its stable event key, returns a native execution reference and reports terminal completion to Scheduler. Native inspection observes the saved process state; no application poller is added.

The job advances only unclaimed nodes and rechecks current workflow management authorization before each. Duplicate jobs/events reuse durable state and atomic node claims. A terminal run is observed without replay. A node left running by a lost worker remains occupied; a possibly completed business action that throws leaves an uncertain run. No lease, heartbeat, takeover, node retry or reset endpoint is introduced. Native job retry is not permission to replay nodes.

Submission and job enqueue are separate service operations. Enqueue failure or a process crash between acceptance and enqueue can leave an accepted run without a job; duplicate submission does not repair it. This unit does not add an outbox or automatic recovery. Drain and individually reconcile such work before cutover. Jobs backend durability, deployment shutdown behavior and multi-worker scheduling remain application acceptance gates.

## Authorized API and explicit copy

All following paths are under `/api`. Authentication and authorization middleware are scoped to these paths. The service rechecks the existing `{resource: {type: 'settings', id: 'workflow'}, action: 'manage'}` grant; denied and conditional decisions fail closed. This is administrator-level workflow management, not an employee-owned run inbox. Application boot now registers that resource even while processes are disabled if the retired plugin is absent, using application-owned translated titles and the Automation subsection. An existing plugin registration is preserved; an existing item without `manage` fails startup. No grants or assignments are added. The history-copy command performs the same catalog registration without booting providers or starting workers.

| Method and path                       | Result                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /processDefinitions`             | Bounded compiled definition catalog, with hashes and input schemas.                                         |
| `POST /processRuns`                   | Validates `{key, hash, eventKey, input}`, durably accepts and enqueues, returns 202. Body limit is 256 KiB. |
| `GET /processRuns/:eventKey`          | Saved status and node outputs after a fresh authorization check.                                            |
| `GET /processHistory/definitions/:id` | Copied snapshot, or physical retained definition/nodes/statistics.                                          |
| `GET /processHistory/runs/:id`        | Copied snapshot, or physical retained run/node results.                                                     |

An external event key is namespaced by definition key and actor and stored as a digest. Reusing it with different validated input or revision fails. Copied legacy IDs remain exact strings, including bigint values. Old physical history is readable after old Collection metadata is unregistered; no retired workflow route is required. Reads do not copy records or enqueue work. There is no migration HTTP endpoint.

With legacy writers stopped, an authorized operator can explicitly copy one unit:

```sh
pnpm nocobase app migrate-process-history --source-version 1.0.0-beta.32 --workflow <legacy-id> --hash <compiled-artifact-hash> --user <manager-user-id>
```

The command connects/registers the application without starting workers. It checks the supplied user's native workflow permission and loads the built catalog. It requires the separately reviewed legacy-module bindings. The entire target unit and existing ledger entries commit in one outer transaction. Replay rereads and validates physical sources, preserves subsequent target edits, and writes nothing. A changed source or child run set, target conflict, or missing target fails; a later child failure rolls back the definition and earlier children. Old tables are unchanged. New migration `202610270035` adds two snapshot tables and nullable execution actor state; its down direction refuses populated process state.

## Measured costs

The synthetic SQLite trace includes metadata queries; authorization callbacks and business services are substitutes, so their production queries are excluded. Each request also pays its native authentication/authorization cost. A history copy below contains one definition and one successful run.

| Operation                | SELECT | INSERT | UPDATE | Transactions / ledger savepoints |
| ------------------------ | -----: | -----: | -----: | -------------------------------- |
| Retained definition read |      5 |      0 |      0 | 0 / 0                            |
| Retained run read        |      7 |      0 |      0 | 0 / 0                            |
| First history copy       |     51 |      4 |      0 | 1 / 2                            |
| Same copy replay         |     51 |      0 |      0 | 1 / 2                            |
| Copied run read          |      1 |      0 |      0 | 0 / 0                            |
| New run acceptance       |      7 |      1 |      0 | 1 / 0                            |
| Three-node execution     |     61 |      3 |      9 | 6 / 0                            |
| Duplicate event          |      2 |      0 |      0 | 0 / 0                            |
| Current run read         |      1 |      0 |      0 | 0 / 0                            |

The native Scheduler end-to-end trace includes cold synchronization/activation, one firing, Jobs execution and occurrence reading: successful branch 95 SELECT / 7 INSERT / 13 UPDATE / 8 transactions; failed branch 75 / 6 / 10 / 6. These are whole-unit measurements, not incremental per-poll estimates. Normal submission queues one process job; concurrent first submissions may queue duplicates, while node claims prevent repeat execution. Each scheduled terminal completion calls the existing native completion service, with its own persisted occurrence update. No application lock, recurring scan or polling request is added; native Scheduler's existing reconciliation remains native behavior.

### Lost and late completion recovery

The recovery test holds the process node until native dispatch has stored its accepted reference, then suppresses exactly one terminal notification. It rebuilds the process catalog/service, Jobs executor, target binding and native Scheduler service against the same SQLite database. The reconstructed process inspection finds the persisted success or failure; native Scheduler reconciliation inspects that reference and changes the waiting occurrence to the same terminal result without re-executing a node or business write. A late report through the original handle and a duplicate report through the rebuilt handle are idempotent. Wrong target type/id references return `REFERENCE_MISMATCH`; a conflicting terminal result returns `COMPLETION_CONFLICT`; the final occurrence state remains unchanged and the rebuilt service queues no replacement job.

Immediately after reconciliation, before any late or duplicate report, the test reads the persisted occurrence and asserts its terminal status and original reference. It also confirms that the process node ran once, the synthetic business handler ran once on success and zero times on failure, and reconstruction queued no replacement job. The later valid and invalid reports are checked against that recovered state.

The test drives the concrete Scheduler service's `reconcileOccurrences()` directly so it does not wait for the provider timer. As in the existing integration tests, concrete `sync()`, `activate()` and `listOccurrences()` are test setup/observation surfaces; the application's public Scheduler token remains registration-only. No production recovery API or polling loop is added.

The following counts are per measured SQLite operation in each success and failure case. `BEGIN` and savepoint counts are zero throughout.

| Operation                                            | SELECT | INSERT | UPDATE | DELETE |
| ---------------------------------------------------- | -----: | -----: | -----: | -----: |
| Read waiting occurrence before reconstruction        |      2 |      0 |      0 |      0 |
| Query terminal process state through rebuilt service |      1 |      0 |      0 |      0 |
| Native Scheduler reconciliation                      |      3 |      0 |      2 |      0 |
| Read persisted occurrence immediately after recovery |      2 |      0 |      0 |      0 |
| Late report through the original handle              |      1 |      0 |      0 |      0 |
| Duplicate report through the rebuilt handle          |      1 |      0 |      0 |      0 |
| Wrong reference type                                 |      1 |      0 |      0 |      0 |
| Wrong reference ID                                   |      1 |      0 |      0 |      0 |
| Conflicting terminal report                          |      1 |      0 |      0 |      0 |
| Final occurrence state read                          |      2 |      0 |      0 |      0 |

The recovery test uses a synthetic definition, authorization callback and business handler that increments a counter; it does not use the real work-item store. The existing concurrent-trigger test exercises the real work-item store and confirms only one item is saved. Scheduler and Jobs services, target handles, process persistence and SQLite are real in the recovery test; no full process exit/reopen, deployment identity, HR permission policy, PostgreSQL or production Jobs backend is exercised. The existing selected identity-denial and permission-revocation tests still run alongside it.

## Verification and remaining gates

The independent target-package checks execute actual SQLite state and ledger transactions, artifact compilation/loading, native Jobs and native Scheduler migrations/service/dispatch/completion. Scheduler dispatch is invoked through its captured native scheduled job, without waiting for wall-clock timers. Success and failure persist as native occurrence outcomes. API tests use actual routes and services with substituted identity/authorization middleware. Cases also cover invalid input, branch selection, duplicate events, permission withdrawal, lost-worker no-replay, reopened history without Collection metadata, exact bigint IDs, rollback, replay preservation and schema rollback refusal. The targeted recovery selection passed **8 tests; 20 tests were skipped by the explicit name filter** in an isolated snapshot based on implementation commit `4ac7925` (the original `41fe950` baseline plus the recovery tests), with the latest assertion update applied. Re-run the selected cases with:

```sh
pnpm exec vitest run tests/logic/process-integration.test.ts -t 'reports a real Scheduler occurrence|recovers a lost Scheduler completion after service reconstruction|runs the actual work-item|blocks unbound|observes delegation removal|rechecks real permission-set revocation' --disableConsoleIntercept
```

Prettier and `git diff --check` pass for this unit. ESLint still reports the same three baseline errors (`readFile` unused and two `prefer-const` findings). Strict single-file TypeScript checking still has 34 diagnostics; its normalized diagnostics match the `4ac7925` baseline, with none in the added recovery assertions. These failing checks are recorded without suppressions or rule changes.

The strict semantic type subset includes the process runtime, routes/config, new migration, both CLI commands and build hooks against public target packages. Full repository checks cannot run with the unresolved legacy package/CLI environment. The application package manifest and lockfile remain unchanged for later template/dependency integration; public target validation dependencies live outside the repository. No production deployment or credentials are accessed.

Still required before cutover: real installed definition/module inventory and business handlers; all remaining workflow instructions, parameter/version/editor/management capabilities; production Jobs/Scheduler policies and real authentication; PostgreSQL; full CLI, build and strict source/compiled startup. There are no page changes in this unit. Complete application/browser acceptance and original compiled migration package, manifest and checksum archive remain outstanding. Official source and synthetic migration execution do not satisfy that archive requirement.

AI remains disabled independently. Required preflight counts now block unaudited old-mapper profiles and unresolved CUSTOM/default-ASK/autoCall differences. Ledger `unchanged` never establishes correct tool policy and never authorizes overwriting subsequent edits. Both replacement verification flags remain false in the preflight command.

## Business source inventory and independent wiring

The repository contains no confirmed legacy business definition or module contract to bind. Production `processDefinitions`, `processHandlers` and `legacyProcessModules` remain empty. A synthetic work-item contract is used only in tests; it is not added to the application registry. Source absence does not establish that a deployed database has no workflows.

| Checked source                                                                                                                | Result and treatment                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/config/workflow.ts`, tracked `workflows/**` and `dist/workflows/**`                                                   | The old configuration names `workflows/` as both roots. No tracked definition or artifact exists at those roots. No definition is reconstructed from a task name.                                                                                                                                                                                                                                                           |
| `server/`, `cli/`, `client/`, `database/` references to the old package, services, collections, DSL, modules and trigger APIs | Old runtime references are the three plugin registrations and workflow configuration; remaining collection/trigger references are replacement infrastructure. No application import of a legacy business workflow module or business call to the replacement process service was found. `Workflow` in `client/routes.ts` is an icon.                                                                                        |
| `server/providers/hr/index.ts`                                                                                                | Eleven native Scheduler targets, with fifteen schedules after expanding the attendance and payroll loops. Mail, maintenance, attendance, AI automation, profile, performance, talent review, payroll and recruiting call their existing services directly. They are not old Workflow definitions and remain on their existing paths. Their deployed configuration and full target-version lifecycle have not been verified. |
| `server/providers/hr/job-events.ts` and `HrProvider.registerJobEventHandlers()`                                               | HR changes dispatch registered application event handlers with their existing persistence and retry rules. Moving them to the process engine would change their contract; no alias is introduced.                                                                                                                                                                                                                           |
| `database/main/migrations/`, seeds, `tests/` and build hooks                                                                  | Business migrations contain no legacy workflow definitions or node/module seeds. Existing process tests and retained-history fixtures are synthetic. The build hook compiles only the explicit process registry. Historical migrations and seeds remain unchanged.                                                                                                                                                          |

The minimum next input is a deidentified deployment definition inventory: stable definition/revision IDs and digests, enabled/current state, input and parameter schemas, node topology/config/options, referenced module names plus their handler contracts and source, artifact manifest/digests, and native schedule IDs with intended execution-user IDs and required grants. Do not include credentials, personal data or runtime input/result bodies. A name alone is insufficient to establish equivalent arguments, branch joins, side effects or permissions. Original installed compiled packages and migration manifests/checksums remain a separate archive gate.

The existing preflight now also requires five workflow counts, even when zero:

| Field                     | Blocking condition                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `unqueuedRuns`            | Accepted runs whose native job acceptance cannot be established, including acceptance/enqueue gaps. |
| `interruptedNodes`        | Occupied or uncertain nodes that require individual reconciliation.                                 |
| `unmappedParameters`      | Definitions with parameter/argument semantics not yet mapped.                                       |
| `unmappedBranchJoins`     | Definitions with unsupported branch convergence.                                                    |
| `unverifiedScheduleUsers` | Unbound schedules or execution users/grants that have not been verified.                            |

Missing fields invalidate the inventory; positive counts block cutover. These metadata counts are operator-supplied evidence from an actual installation, not an automatic scan or repair. Zero does not bypass the existing unverified-runtime gates. No reset, node replay, outbox, automatic enqueue repair, takeover or new persistence is introduced. Existing target edits and retained source rows stay untouched.

### Wiring verification and incremental cost

The added tests start the native `Application` lifecycle with `ProcessesProvider`, Scheduler and Jobs on independent SQLite databases. Native permission sets, settings catalog, grant assignment/revocation and authorization middleware participate. A test-only module registry and artifact directory supply the existing branching contract; its write handler calls the actual `createWorkItemStore`. The production registry remains empty. Session identity and active-user discovery are supplied by test fixtures; full authentication, HR roles and the complete application provider set are not covered.

Captured native schedule firings cover concurrent duplicates, unbound/unpermitted users, delegation removal, disabled configuration and node-to-node revocation with failed occurrence reporting. Route requests through the started application cover anonymous, denied, permitted, cross-user and revoked access. Rebuilt authorization/provider instances read the saved grant without loading the retired Workflow plugin. Invalid configuration reloads are rejected and retain the old value. Prior history rollback, replay preservation, input/branch and interrupted-node regressions remain in the suite.

The new source adds zero SQL, writes, locks, transactions, HTTP requests or polls to process acceptance, execution or reads. Boot performs an in-memory resource lookup/registration, without grant writes. Scheduled acceptance additionally parses the in-memory delegation map (at most 1,000 entries); no delegation database query is added. Config reload validates the map once as well. Preflight performs five additional integer checks in memory.

The new SQLite trace includes actual native authorization and work-item queries, unlike the earlier substituted authorization trace. It excludes session/user-discovery database queries and other HR services. Warm definition listing uses 2 SELECT; first denied listing uses 5 SELECT including cold metadata, with no writes. A successful three-node native firing delivered concurrently twice uses 96 SELECT, 7 INSERT attempts, 11 UPDATE, 8 outer transactions and one work-item savepoint; this excludes prior startup/synchronization and grant setup. The duplicate occurrence's unique-key INSERT attempt is included, not a second saved occurrence. Exactly one work-item is persisted. A direct terminal-process duplicate uses 1 SELECT and no writes. These whole-sample costs cannot be subtracted from the earlier cold Scheduler trace as an incremental runtime cost.

## Presentation foundation (fixed template .76)

The [separate presentation unit](process-presentation-unit.md) adds the standard Flow/Lifecycle diagrams and workflow-management display parts. It registers no business page or definition and does not change this runtime, scheduler, histories, authorization or closed cutover gate. New-environment definition/parameter/history adapters still require actual repository contracts and authorized current APIs. They do not wait for a nonexistent old deployment inventory.
