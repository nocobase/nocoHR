# Non-poll mail completion feedback

Audit pack confirmation now guarantees only that the pack was built. Billing's post-reconciliation draft callback propagates an actual recorded failure to its existing background error handler. Saved packs, reconciliation notes, partial drafts and original task errors remain available. Production shutdown order is unchanged; complete upgrade acceptance remains open.

## Confirmed boundaries and minimal repair

- Audit `buildPack` saves the pack before the optional reply task. Disabled drafting, failure before draft persistence, and failure after persistence all return the saved `packReady` request. The previous English and Chinese toast incorrectly promised a drafted reply. Both translations now say only “Audit pack built”. The response contract, pack workflow and existing task error records are unchanged; no new completion field, query or retry is needed. The Mail section remains the source for actual drafts.
- Billing `draftForBill` previously awaited an automation outcome but discarded its failed status. Controlled failure and partial-persistence regressions reproduced a normally resolved promise. It now uses the existing `runMailTask` boundary, which rethrows the original work rejection after automation saves its failed outcome. The already-installed `inBackground('hrAssistant.mailReplyBilling', ...)` catch receives that rejection. No new handler, notification, model call or processing pass is added.
- Billing's reconciled notification and saved notes describe reconciliation, not delivery of a reply. They are already truthful and are retained. Draft creation does not send mail. Missing source mail, disabled tasks and consumed dedupe keys stay non-failing. Repeating the same consumed trigger does not recreate a draft, including after a recorded failure.
- Rebuilding an audit pack explicitly is existing supported behavior: a new pack ID starts a new reply trigger. This repair does not make explicit rebuilds idempotent. The regression replays the exact existing automation trigger instead, and verifies no replacement draft or pack. There is no new storage, authorization, dedupe or retry policy.

## Independent verification and current artifact follow-up

Independent verification at `50cad3c` passes all 51 related cases and closes the non-poll feedback findings. The [current integration record](current-integration-checks.md) supplies the subsequent current-source build/entry checks and three additional real background-catch bridge cases. Its single complete suite passes all 2022 assertions but retains an organization-close hook timeout, exit 1. The earlier artifact-reuse statements below describe this unit's original delivery, not the later current build.

## Verification

- Before repair: actual English and Chinese component actions display the overbroad toast. Real billing failure and partial-persistence cases resolve instead of rejecting (two service failures). These are separate from test calibration failures retained in the delivery archive.
- Related five-file selection: **50 passed** (8 new service cases, 2 new interaction cases, 15 mail-result boundary cases, and 25 existing audit/billing cases). The strengthened final service file passes **9 cases**, adding the legitimate no-source skip. Unique coverage is **51 cases**, not the sum of repeated executions.
- The real service fixture uses the ordinary standalone application, SQLite, native username authentication, real automation ownership/deduplication and real pack/file storage. Audit cases check downloadable nonempty packs, actual draft counts, persisted failure reasons/completion times, anonymous 401 and unauthorized 403. Original saved packs and drafts remain after denial.
- Billing cases ingest nonempty EML through the local Mail adapter, bind it to an isolated synthetic reconciled bill, then call the registered production service. Reconciliation rows are synthetic fixture inserts; this does not repeat spreadsheet parsing acceptance. Tests cover disabled, success, failure before draft persistence, partial persistence with the same original rejection, existing notes, owner-side business authorization, public 401/403 and duplicate/no-source inputs.
- Fault injection is limited to the public draft method: reject before the write, or invoke the original real method and reject after its write. It does not mock the task runner, business work or successful persistence. Notification transport is independently best-effort in the existing notifier; an initial test incorrectly expected its rejected send to fail the task. That calibration was corrected without changing production notification behavior.
- English browser acceptance passes against the real application route `/main/talent/audit?tab=requests&request=...`, real Vite client, real Node listener, native synthetic administrator and fresh SQLite/storage. Drafting is disabled through the normal automation service. One pack POST yields the neutral toast and a download button; the database has zero reply drafts. There are 15 browser API requests including shell/locale and existing refresh reads, no page errors and no external requests. The screenshot is a real business page, not a component host.
- Server and client TypeScript plus the mail-boundary/browser and component scopes pass. Changed-code lint and formatting pass. These ordinary callback/copy changes do not affect bootstrap, dependency loading or build configuration; final artifact/idle startup, real HTTP request ordering and static same-path recovery evidence from the preceding unit is reused. No full build, full-suite, close-pressure or recovery rerun is claimed here.

## Costs

The runtime diff adds **zero SQL, writes, transactions, locks, model calls or HTTP requests** per pack action or billing callback. It only changes a translation and consumes the already-returned task outcome. This is incremental database/request analysis, not a claim that the original operation costs nothing. The existing background catch now emits its failure warning for a failed billing callback; log-sink I/O was not separately measured. Existing skipped/duplicate task rows and the open-draft replacement DELETE remain.

Measured operation windows from the final service run:

| Operation                     | SELECT | INSERT | UPDATE | DELETE | BEGIN / COMMIT |
| ----------------------------- | -----: | -----: | -----: | -----: | -------------: |
| Audit, drafting disabled      |     98 |      3 |      1 |      0 |          0 / 0 |
| Audit, failure before draft   |    105 |      3 |      2 |      0 |          0 / 0 |
| Audit, failure after draft    |    242 |     22 |     15 |      1 |          7 / 7 |
| Audit, success                |    148 |      8 |      2 |      1 |          2 / 2 |
| Billing, drafting disabled    |      4 |      1 |      0 |      0 |          0 / 0 |
| Billing, failure before draft |     29 |      1 |      1 |      0 |          0 / 0 |
| Billing, failure after draft  |     33 |      2 |      1 |      1 |          0 / 0 |
| Billing, success              |     57 |      5 |      1 |      1 |          2 / 2 |

Repeated enabled audit triggers: 2 SELECT / 1 existing skip INSERT; disabled: 1 / 1. Repeated enabled billing triggers: 5 SELECT / 1 skip INSERT; disabled: 4 / 1. These windows exclude fixture creation, task configuration and verification reads; they can include concurrent local Mail/notification work. The larger partial-audit sample is not attributed solely to draft persistence, nor compared as a performance effect. Both draft paths are templates, use no model, and no external channel/model is configured. Browser SQL, whole fixture initialization, cleanup and local outbox costs were not separately aggregated and are not zero.

## Remaining boundaries

- The original complete run remains **1988 passed / 1 failed, another close timeout, exit 1**. Its leave fixture has separately passed the correction; there is no new complete green run. Other historical shutdown failures remain individually recorded.
- The [shutdown proposal](mail-shutdown-approach.md) remains separate for owner review. Neither the unsafe Mail/Scheduler exchange nor a Jobs-only adapter is installed. Current public contracts still cannot jointly stop and join reconciliation, mail/Agents work, state/event delivery and accepted reports. No external package/CI work is undertaken.
- Persistent Knowledge Q&A remains deferred. Fixed dependencies, 138 historical sources, 284-path ownership ledger, preflight, source gates and `.54` remain. The PR stays draft; empty checks mean no CI result. Independent review of this increment is pending.

## Reproduction and preservation

```sh
node node_modules/vitest/vitest.mjs run tests/logic/mail-completion-feedback.test.ts tests/components/audit-pack-feedback.test.tsx tests/logic/mail-task-result.test.ts tests/logic/v3-mail-audit.test.ts tests/logic/v2-mail-billing.test.ts --maxWorkers=1
pnpm exec playwright test --config tests/playwright/mail-completion.config.ts
pnpm exec tsc -p tsconfig.server.json --noEmit
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec tsc -p tests/tsconfig.mail-status.json
pnpm exec tsc -p tests/tsconfig.mail-completion-client.json
```

The browser test shuts down only its disposable Scheduler executor to isolate unrelated calendars; one-off file/notification Jobs and normal application cleanup remain. It does not validate production drain. The service tests retain active calendars and the original 30-second teardown budget. All disposable listeners and instances close; no management credentials or external mailbox is used. The [manifest](evidence/mail-completion-manifest.json) records the 145 protected hashes, unchanged production composition and this unit's source hashes. Raw failures, final logs, cost windows and the English screenshot accompany delivery.
