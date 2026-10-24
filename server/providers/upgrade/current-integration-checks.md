# Current application artifact and integration checks

Snapshot: the following build/full-run evidence belongs to `dbb8355`. The [bounded follow-up](template-marker-followup.md) records the later authorized source-marker synchronization to `.76` and its single diagnostic replay; original failures and the historical `.54` preservation manifest below remain intact. Production runtime source is unchanged.

Current production source is unchanged from `50cad3c`. Its complete build, three-project types, whole-repository lint/format and strict source/compiled idle entries pass. The single complete run has 2022 passing assertions but exits 1 because organization-sync application teardown exceeds 30 seconds; historical failures remain separate. No lifecycle adapter or dependency change is installed, and full background drain remains an external public-contract gap.

## Current validation matrix

| Check                                               | Scope / result                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete current build                              | `pnpm build`, exit 0; client/tooling checks, server compilation, migration manifests, runtime dependencies and final artifact pass. All 36 imported server/database/CLI packages reach the build. Linux x64 glibc, Node 24 / ABI 137. |
| Three-project types                                 | `pnpm typecheck`, exit 0 (client, tooling and server). The portable mail-boundary/browser scope also passes after adding the bridge regression.                                                                                       |
| Whole-repository quality                            | `pnpm lint`, zero errors/warnings, and `pnpm format:check`, exit 0. Records added after that scan receive a final formatting/link check; no rules or ignores change.                                                                  |
| Actual source entry                                 | Fresh isolated SQLite/storage, explicit synthetic configuration, strict startup, one health request returning 200, one SIGTERM, natural exit 0; 21,414 ms to readiness and 143 ms close.                                              |
| Actual compiled entry                               | Separate fresh SQLite/storage, production environment and the emitted standalone entry, strict startup, health 200, single SIGTERM, natural exit 0; 14,602 ms to readiness and 124 ms close.                                          |
| Background callback integration                     | Registered payroll review → original `onBillReviewed` → original `inBackground` → real billing draft task → existing error catch. Final targeted file: 12 passed, including three added bridge cases.                                 |
| Complete business/permission suite                  | 241 files pass / 1 fails (242), 2022 assertions pass, no failed/pending/todo assertions, exit 1. Organization-sync afterAll exceeds 30 seconds. No second full run.                                                                   |
| Installation / real in-flight HTTP / static restore | Reused within unchanged scope; no new install, HTTP-lifecycle or restore result is claimed.                                                                                                                                           |
| CI / complete drain / owner acceptance              | CI collection is checked on the final head. Complete background drain remains unproven; the independent lifecycle proposal still awaits owner review.                                                                                 |

The runtime build represents the same production bytes in the final test/record-only commit. A source inventory and the protection manifest accompany delivery. The new test does not change the emitted application.

## Real background trigger

The new regression does not call the reply callback as its starting point. It calls the registered `payroll.assistant.review` entry on a synthetic reconciled bill linked to nonempty Mail/local EML. Its actual application callback schedules the existing background work, whose original catch receives the original failure object. Call-through spies observe public service/logger methods; no task runner, callback, catch, private field or prototype is replaced.

The success, pre-write failure and post-write failure cases assert existing notes, actual draft IDs, separate task outcomes/completion times, and unchanged exact-trigger dedupe. In the partial case the original draft method really persists before rejecting. The review task remains succeeded for the completed reconciliation; its independent reply task is failed and the existing catch logs that failure. This does not claim that a reply was completed, or change a completed review into a failed review. A duplicate review does not invoke the callback again or create another draft.

The earlier independent 51-case mail selection and real English audit-pack page remain valid. This increment adds three bridge cases, not a new notification or processing pass. It does not repeat spreadsheet-upload parsing or external model/mail integration. The callback itself uses the existing template draft path; no model is configured.

## Single complete run and retained history

Exactly one complete run executes with `--maxWorkers=2`: **241 files pass / 1 fails (242), 2022 assertions pass (2022), exit 1**, 891.79 seconds. The JSON reporter's nested suite totals are not file counts. The failed file's nineteen assertions all pass; its unchanged `tests/logic/v1-org-sync.test.ts:149–150` afterAll waits for `server.close()` beyond the original 30-second hook. All assertions, hook budgets, production order and test isolation stay unchanged. The corrected leave client, current mail bridge, file-security and previously observed training/authorization/profile fixtures pass in this run; that does not erase their historical failures.

The original failing organization fixture has no close observer. Its own scoped application log and a post-exit readonly snapshot retain one running `app.hr-mail-poll` occurrence and three unfinished Mail sync rows (one running, two pending); all seventeen persisted organization-sync runs are succeeded. These are correlated historical records, **not evidence of the live blocking provider/call**. In particular, pending rows after assertion timing do not prove that Mail was the awaited close operation. JSON per-file assertion timestamps are not successful teardown timestamps.

One targeted diagnostic then runs only the unchanged nineteen-case organization suite in an isolated `50cad3c` source archive, with the already-tested public Mail method observer and passive provider-state close helper. It passes nineteen cases and closes in **43 ms**, with zero observed Mail reads/runs/pending calls at close. The original promise/receiver, normal calendars and 30-second hook remain; no Scheduler private method or prototype is replaced. The instrumentation patch accompanies delivery and is **not installed in shared source**. There is no repeated full run and no claim that this targeted pass repairs the complete-run failure.

**Responsibility and next minimal diagnostic:** the demonstrated failure remains the application-close boundary of the organization fixture, not a failed organization business assertion or a newly proved mail callback defect. The exact waiting provider is unlocalized in the failed full window. The smallest next observation, if another representative run is authorized, is the attached passive provider/public-Mail instrumentation on that fixture before the load begins. Use its same-window pending calls to choose a responsibility point; do not infer an order change from the persisted snapshot or expand calendar isolation. Complete public background-drain limitations remain independently known, not a blanket attribution for this particular timeout.

The old integrated result remains **1988 passed / 1 failed, another file-security close timeout, exit 1**. Its leave eligibility was separately repaired with isolated working shifts and rest-day rejection, without changing historical seeds or production leave rules. Older training/authorization/profile, attendance/Feishu and organization/mail shutdown windows retain their original evidence and scope; one new run cannot retrospectively prove a shared cause or eliminate an intermittent failure.

No dependency/provider order, close timeout, admission gate, claim, lease, retry, lock, assertion or disabled test is changed here. The current public lifecycle still cannot jointly stop and join reconciliation, Mail/Agents business work, state/event writes and accepted reports. [The separate proposal](mail-shutdown-approach.md) remains for owner review. Neither the unsafe registration swap nor the disproven executor-only adapter is installed.

## Reused evidence and applicability

The corrected acceptance archive in [the application-only record](app-only-acceptance.md) supplies frozen installation/toolchain, standalone and embedded real-listener admission/request/response ordering, and safe static same-path main/file/vector/queue restoration. Forty-four relevant manifest/lock, startup/config/HTTP/composition and acceptance-script paths are byte-identical to `ee65977`. New mail result/copy bytes were never treated as covered by that old build: the current build/entry checks above replace only that artifact gap, while the new bridge and existing mail tests cover current behavior.

Static recovery requires all fixture/listener/worker work complete, no active controlled-model request and stable file inventories before the copy. That evidence is still static recovery, not a proof of draining active work. Current startup children have external channels, models and compatibility execution explicitly disabled, own separate temporary resources and close before those resources are removed. The first startup driver omitted the production-required synthetic company name; production correctly refused that configuration. That calibration failure and the first source-only success are preserved separately; after correcting only the owned synthetic configuration both entries pass.

No new page behavior changes here, so the independently checked English page screenshots are reused. There is no used old deployment/data; old-environment migration/restore remains not applicable. New-environment restore and business authorization remain applicable within the recorded acceptance scope. Persistent Knowledge Q&A remains deferred.

## Costs and cleanup

This test/record increment adds no production request, SQL, business write, lock, transaction, model call or retry. It observes the already-installed background logging path; log-sink I/O remains unmeasured. A real review plus its callback costs more than a direct draft call, so these samples must not be compared as performance changes:

| Target bridge window | SELECT | INSERT | UPDATE | DELETE | BEGIN / COMMIT | Model HTTP |
| -------------------- | -----: | -----: | -----: | -----: | -------------: | ---------: |
| Failure before draft |    114 |      7 |      6 |      0 |          4 / 4 |          0 |
| Failure after draft  |    118 |      8 |      6 |      1 |          4 / 4 |          0 |
| Success              |    142 |     11 |      6 |      1 |          6 / 6 |          0 |

These windows include task/notification work and possibly concurrent local fixture activity; they exclude fixture creation/configuration and subsequent verification. Whole-suite initialization, models, database writes and cleanup were not aggregated and are not zero. The two passing artifact instances each issue one health request with no configured model or external channel; their initialization/migration/storage costs were not separately metered. The first configuration-calibration source instance adds one health request, also outside any production budget.

Both final source/build children exit naturally and their synthetic stores are removed. The targeted organization application closes and removes its own fixture. After the complete Vitest process has exited, the remaining failed organization store is inspected read-only and removed with other run-owned temporary fixture/queue directories (fifteen directories in this run). This is cleanup after a failed hook/worker exit, **not successful full-suite application teardown**. No application is force-killed, no timeout is increased and no database/configuration is attached. The readonly postmortem uses four SELECTs and six schema PRAGMAs, no write/model call; diagnostic initialization/API work is additional unaggregated synthetic cost.

## Reproduce and preservation

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
node node_modules/vitest/vitest.mjs run tests/logic/mail-completion-feedback.test.ts --maxWorkers=1
pnpm exec tsc -p tests/tsconfig.mail-status.json
pnpm test --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=<owned-output>/full-tests.json
```

The exact isolated source/build driver and command logs accompany delivery. It refuses common root deployment-config/dotenv names without reading their contents, creates only synthetic configs/stores, retains strict startup and the original 30-second close assertion, and never sends a force-exit signal. The production entry remains the one being tested.

The [current preservation manifest](evidence/current-integration-manifest.json) records 145 protected files, 138 historical sources, 284 ledger paths, unchanged fixed dependencies/lock, preflight, source gates and `.54`, plus byte-identical production composition. Source/build idle close does not supply the missing active-work guarantee. The PR stays draft; independent verification of this final record increment is pending. No merge, release, deployment, external-package/CI work or other issue work is performed.
