# Shutdown drain contract prerequisite

The Jobs-only early-drain adapter is **not installed**. Its reconciliation concurrency prerequisite fails: an official reconciliation inspection can remain active after the public Schedule executor has drained and application dependency cleanup has run. The accepted mail-close ordering diagnosis remains valid, but executor shutdown alone does not provide a complete Scheduler quiescence boundary.

## Mail outcome follow-up after `6ccf2d8`

The [mail status unit](mail-status-unit.md) propagates recorded handler failures through the poll to the existing public Scheduler failed result, while retaining successful partial writes, legitimate skips and deduplication. Correcting the historical outcome mismatch does not keep dependencies alive. Production shutdown order remains unchanged. The [separate owner proposal](mail-shutdown-approach.md) records the remaining public lifecycle gap; no candidate or early-drain adapter is installed. Original full-run failures and deferred persistent Knowledge Q&A remain.

## Historical nonempty mail prerequisite at `6ccf2d8`: candidate rejected

The [nonempty dependency unit](mail-business-dependency-unit.md) finds that exchanging only Mail/Scheduler lets a real recruiting message enter native generation after Agents has closed. The reply task fails and no draft is stored, although the occurrence succeeds and application cleanup completes. The candidate is not installed; further candidate artifact/lifecycle checks stop at this failed prerequisite. Prior leave and real-HTTP evidence is independently accepted. That test-only delivery left production source, fixed dependencies, history and safety gates unchanged. Full background shutdown and the original complete-run failures remain open.

## Leave-fixture and same-window shutdown follow-up

The [test-only follow-up](leave-fixture-close-diagnostic.md) fixes synthetic shift eligibility without changing leave rules or historical seeds. The affected API regressions pass, and their passive observers remain in place. A controlled official mail-target replay captures Scheduler backend waiting on the business poll while Mail has already closed; its original 30-second failure is retained. A narrow application plugin-order proposal is reported for separate review, not installed. The complete reconciliation/derived-work public drain gap and historical full-run failures remain open; no official package or external CI work resumes.

## Current application-only scope (2026-10-24)

The owner withdrew this task's external package implementation, compatibility, publishing and CI work at 08:59. Current published fixed inputs remain Scheduler `.19` / Jobs `.3` / Server `3 beta.2`; no new package is consumed. The public Scheduler service lacks a boundary that stops new reconciliation and jointly awaits accepted inspection, execution, state persistence, event delivery and completion reports. This is a specific external dependency for overlapping background work, not a reason to postpone independent application checks.

The [application-only acceptance unit](app-only-acceptance.md) validates real Node HTTP admission/draining and a safely quiesced synthetic backup. It adds no production lifecycle adapter, task registry, timeout relaxation or calendar change. Embedded hosts must stop their own listener and finish requests before destroying the application scope; calling the embedded application's `close` alone does not own network admission. HTTP response completion does not prove derived background work has settled.

The current application-only full run also times out in the file-security fixture's application close, despite eight passing business assertions. Its post-exit store retains an unfinished mail-poll occurrence and three native mail-sync rows. That fixture has no same-window internal call trace; these persisted symptoms do not identify the exact awaited operation. The [current acceptance record](app-only-acceptance.md) separates this failure, its cleanup and the unrelated leave-fixture assertion from successful HTTP and static-backup checks.

Quality warnings/format findings are closed at `47f38cc`; old counts and the following proposed external design are retained as history. No request to implement or publish that design remains in this task.

## Historical external alternative (not an implementation assignment)

Extend the official Scheduler's public service with one idempotent lifecycle operation, for example `drain()`, and let both an application tail provider and the official final shutdown delegate to it. The plugin owns the timer, executor and event subscription; it can stop new reconciliation ticks, track and await already-started reconciliations, drain the existing executor, and only then release its subscription. Keep dependencies available until this operation settles.

- **Changes:** official Scheduler public token/type and its lifecycle implementation; then an application tail provider and its registration in `server/providers/index.ts`. No application access to private timer/provider/executor fields.
- **Concurrency:** mark closing before starting the executor drain; stop future reconciliation callbacks and await both existing reconciliation and executor/event-delivery promises. Retain original completion/error semantics and the same configured Jobs identity. Final cleanup reuses the same promise.
- **Cost:** no added per-request, per-poll, per-claim or per-scheduled-run SQL/write/lock/transaction. Track existing in-process reconciliation promises; no extra schedule or polling loop. Existing shutdown persistence and terminal-record writes remain real costs.
- **Needs a separate decision:** this is a public package contract change and requires an explicitly reviewed fixed package revision/target exception. This unit does not change dependencies, patch installed packages or implement that contract.
- **Left out:** new persistence, claims, leases, retries, deadlines, cancellation policy, custom runners, forced shutdown and production mail activation. The previously approved local-file-mail causal tests remain evidence of the original problem, not evidence that this new prerequisite passes.

## Controlled contract evidence

The probe uses the installed official Scheduler provider, Jobs service, real SQLite/migrations and real provider shutdown registry. Targets and timing are synthetic. Public target registration creates a waiting occurrence and a second running target. A controlled clock starts the official reconciliation interval; its target inspection is held while application shutdown calls the proposed public executor drain. No plugin private fields are called or changed.

| Interleaving                           | Result                 | Observed order                                                                                                       |
| -------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Inspection completes before close      | Pass                   | inspection end, drain, dependency cleanup, application close                                                         |
| Inspection remains active during close | Safety assertion fails | inspection begin, drain begin, running target end, drain done, dependency cleanup, application close, inspection end |

The final probe has **1 passed / 1 failed**, with the failure at the dependency-lifetime assertion, not a timeout. The original 30-second budget remains. The probe's dependency cleanup hook records its invocation; physical SQLite disposal is deferred until the inspection and its native observation write finish so test cleanup does not manufacture an additional database error. This demonstrates an unjoined lifecycle operation; it is not a natural HR load or external-mail reproduction. Application `app.process` inspections likewise read durable state (`processes/service.ts:117–119`), although production process gates remain closed.

Initial probe setup omitted `AppConfig.loadAll()`. A second harness attempt held the dispatch-time inspection instead of only reconciliation. A subsequent version closed the test database too early during cleanup. Those calibration logs are retained separately; their setup/timeout/cleanup errors are not product failures. The corrected two-case result above is the contract evidence.

The fixed implementation explains the boundary:

- `@nocobase/jobs` Schedule executor shutdown awaits backend close and its event-delivery chain. It has no ownership of Scheduler reconciliation.
- Scheduler starts a separate interval whose callback launches `reconcileOccurrences()` without joining that promise to provider shutdown. Its shutdown clears the timer and closes the executor but does not wait for an already-started reconciliation.
- The public `SchedulerService` exposes `registerTarget` and `defineSchedule`, not a lifecycle/quiescence operation. Reaching the provider's private timer or internal concrete service is not an application integration solution.

Do not install the thin adapter while describing it as satisfying this concurrency requirement. Moving two plugin registrations or repeatedly calling executor shutdown does not join the independent inspection. A narrower executor-only guarantee would need an explicit scope decision; it is not silently substituted here.

## Verification and ownership

Only upgrade records change in this delivery; runtime source remains `125172a`. No application provider, dependency, lock, test gate or private observer is added to production. The 284-path ledger stays unchanged because no template/application runtime path is reclassified. The original full-test failures remain historical evidence. The then-current 17 warnings / 54 format failures were subsequently closed by the independently reviewed quality units; they are not current blockers.

The full test, build and source/compiled startup steps for a new production adapter are not run: the required concurrency check stopped implementation first. Additional adapter-specific custom-config, delayed-mail, subscriber-failure and empty-work regressions are not reported as passed after this prerequisite failure. Earlier startup/build/recovery evidence is retained, not reported as validation of an adapter. Changed-document formatting and links are checked. Probe initialization and native scheduling perform real test SQL/state writes, not metered in this run; no production SQL, external HTTP, model or business write is added.

If a Jobs-only adapter is reconsidered, revalidate the fixed `@nocobase/app-plugin-scheduler` scope, `scheduler.jobs` selection, same executor identity, repeated-close behavior, terminal event delivery and reconciliation lifetime whenever Scheduler/Jobs/Server versions change. Current fixed inputs remain template `.76` / Skills `.44`, Scheduler `.19`, Jobs `.3` and Server `3 beta.2`; no rolling version is selected. Completion marker `.54`, preflight and closed gates remain unchanged.

## Historical protected-history format backlog

The historical 54-file format output did **not** directly include any of the 138 migration/seed source files: those directories are already excluded. It includes these three seed-data helpers, which are imported by immutable historical seeds:

| Format path                             | Historical consumers, all retained byte-for-byte                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `database/seed-data/demo-exams.ts`      | `database/main/seeds/202609280103_hr_demo_exams.ts`                                                               |
| `database/seed-data/demo-recruiting.ts` | `database/main/seeds/202610090102_demo_recruiting.ts`; `database/main/seeds/202610160104_demo_mail_recruiting.ts` |
| `database/seed-data/demo-training.ts`   | `database/main/seeds/202609290102_hr_demo_training.ts`                                                            |

All three helpers are byte-identical to true pre-upgrade `2bfd8d1`. They are dependencies of historical seeds, not three additional members of the 138-file set. Recommended separate cleanup: format only the helper data files, compare exported syntax/data semantics and resulting synthetic seed data, and prove all 138 source hashes remain unchanged. Do not rewrite the four historical consumers, repair checksums, or add a blanket formatter exemption. If those helper validations cannot be supplied, keep their three failures explicitly open. This unit edits none of them.
