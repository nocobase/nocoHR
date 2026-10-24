# Conflict-check model-input authorization

Conflict checks now read and send only documents currently available to the task owner. Controlled production-task tests reproduced the earlier unauthorized full-text/model input and verify the correction. This is an application service boundary fix; browser exploitation was not tested. The complete upgrade remains unaccepted and the PR stays in draft.

## Authorized inputs and preserved behavior

- Reject unsupported restricted credentials before refreshing the task owner. Resolve the ordinary owner's current subjects and require both `knowledgeAssistant/use` and `kbDocument/view`; intersect their existing row and field policies with Repository `narrow`. No new grant or visibility policy is defined.
- Select eligibility metadata through that intersection before reading full text. Only active, ready, current, non-draft, non-translation question sources within the existing configured document/category scope participate. A hidden or ineligible target is skipped; no visible comparison candidates produces no model call.
- Refresh current subjects, both policies, source scope and document text immediately before generation. Build the prompt from that refreshed selection and pass its authorization to the existing native structured generator. Notification-time checks alone did not protect model inputs.
- After generation (including rule fallback), recheck authorization and source metadata before recording results. Withdrawn grants fail through the existing task handler; changed/hidden sources are discarded. The prompt is authorized at submission; permission changes cannot retract an already transmitted request.
- The existing deterministic comparison, version-section selection, structured validation, native deadline, conflict deduplication, review and notification behavior remain. Document contents, approvals and source references are not edited by this unit. `visibleDocumentIds` now selects IDs only, so notification recipient eligibility does not unnecessarily fetch unrelated document bodies.

## Verified and unverified

The tests use actual application composition, SQLite, Repository policies, HR subject resolution, automation task persistence, native Agents execution and a loopback HTTP model. Captured database result rows identify full-text reads; the controlled model records its actual input. Setup uses synthetic users/documents and real department/position/certification relations and grants.

- Before: two independent hidden-target/hidden-candidate checks failed. Full-text results included forbidden documents; their sentences reached one controlled model request per check. Evidence is service/task level, not a demonstrated public HTTP exploit.
- After: owner, ancestor-department, position and valid qualification grants produce the authorized pair and one open conflict. A higher-privilege fixture administrator owns the secret document, but that identity never supplies task generation rights. The secret body is neither fetched nor sent.
- Requiring only use or only view is rejected. Broad use/narrow view and narrow use/broad view retain the narrower range. Hidden target, hidden candidates, no visible candidates, draft, translation, superseded and configured-out sources do not call the model.
- Removing use or view between candidate discovery and generation produces no model request. Removing view while the HTTP request is pending preserves native terminal persistence but records no conflict. A restricted direct service entry performs no subject refresh, document read, model request or SQL.
- The full native composition and legacy knowledge-service suites pass: **112 tests**, including the prior 83 native cases and 19 new conflict cases. A final filtered conflict run repeats the strengthened denial-status/full-text assertions. The legacy suite covers normal conflict notification, revision handling and manual review requirements.
- Unverified: production databases/HR permissions, external models, concurrent administrator changes within an individual database operation, installed-data recovery and full process restart. No new transactional authorization or locking mechanism is introduced. The known notification-page assertion and failed-session task trace boundary remain recorded; that unrelated assertion was not rerun here.

## Observed complete-operation costs

Counts below are from the complete two-file run. Setup and assertions are outside the measurement. They include real authorization, native storage, task terminal writes and conflict/notification writes when present. Read totals vary with caches and asynchronous notifications; these are observations, not fixed budgets or optimization claims. Positive cases fetch the two authorized bodies twice (discovery and refreshed input); the final recheck selects metadata only.

| Operation                                                | Models | SELECT | INSERT | UPDATE | DELETE | Transactions |
| -------------------------------------------------------- | -----: | -----: | -----: | -----: | -----: | -----------: |
| Own documents                                            |      1 |    336 |      9 |      7 |      0 |            6 |
| Ancestor department                                      |      1 |    350 |     11 |     11 |      0 |            8 |
| Position                                                 |      1 |    350 |     11 |     11 |      0 |            8 |
| Valid qualification                                      |      1 |    368 |     11 |     11 |      0 |            8 |
| Hidden target                                            |      0 |     75 |      1 |      1 |      0 |            0 |
| Hidden / no visible candidate, each                      |      0 |     77 |      1 |      1 |      0 |            0 |
| Use without view                                         |      0 |     47 |      1 |      1 |      0 |            0 |
| View without use                                         |      0 |     23 |      1 |      1 |      0 |            0 |
| Either action narrower, each                             |      0 |     71 |      1 |      1 |      0 |            0 |
| Revoke use before generation*                            |      0 |    102 |      1 |      2 |      1 |            1 |
| Revoke view before generation*                           |      0 |    126 |      1 |      2 |      1 |            1 |
| Revoke view during model request*                        |      1 |    247 |      4 |      8 |      1 |            5 |
| Draft / translation / superseded / source-excluded, each |      0 |     75 |      1 |      1 |      0 |            0 |
| Direct restricted service entry                          |      0 |      0 |      0 |      0 |      0 |            0 |

`*` Revocation measurements include the injected permission-assignment removal (one DELETE, its UPDATE and transaction). These are test administration costs, not deletions performed by conflict checking. The task still writes its existing failed terminal record. After-model withdrawal also pays for the already admitted native request and session finalization, but no conflict/notification write. Successful paths write one conflict plus existing notification/native/task records; they do not change HR source documents. Zero-model refusal is not zero SQL.

The original failing captures observed 383 and 674 SELECT respectively with uncontrolled eligible seed candidates and notifications. The final fixture narrows the real configured source scope to its three synthetic document numbers for stable isolation. Those before/after SQL totals are not comparable performance budgets. Full raw captures and the original reproduction patch accompany delivery.

## Reproduce and retention

```sh
pnpm exec vitest run tests/logic/native-ai.test.ts tests/logic/v1-knowledge-service.test.ts --disableConsoleIntercept
pnpm exec vitest run tests/logic/native-ai.test.ts -t 'conflict (model input|entry)' --disableConsoleIntercept
pnpm exec tsc -p tsconfig.server.json --noEmit
pnpm exec eslint server/providers/hr/knowledge-conflicts.ts server/providers/hr/automation-tasks.ts server/providers/hr/knowledge-service.ts tests/logic/native-ai.test.ts --max-warnings 0
```

No installation, full build or unrelated browser check is needed for this server-only unit. The production connection is `automation-tasks.ts` → `createConflictCheck` → the existing native structured generator; its new dependency reads existing AI-entry source settings. No Knowledge plugin registration, indexing, mapping, schema, authorization policy or document-body chat tool is added. Dual-source search and persistent knowledge chat retain their separate product/official-contract gates.

All 138 tracked migration/seed files are byte-identical to `b690614`. The manifest/lock, fixed template `.76` / Skills `.44`, source completion `.54`, historical data, closed compatibility/process switches and preflight remain. Notification legacy failure, failed-session task trace, Agents `.18` metadata-v1 coupling, Workflow and installed-database/backup verification remain separate. No external credential was read, external model called, production channel enabled, deployment or release performed.
