# Native routing, vendor-bill tools and IM approvals

Routing, vendor-bill review and private IM replies now use native Agents services. The approved card binding continues the original native execution, with current sender/recipient/owner checks and tool reauthorization. Production channels remain unactivated. The complete template upgrade remains unaccepted: keep the pull request in draft and do not deploy.

## Delivered caller changes

| Caller                                 | Before                                                 | After                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiEntryService.route`                 | Old employee model selection, structured/text guessing | Official structured generation, same authorized row audience and keyword fallback, 30-second total deadline, original caller AuthorizationContext                    |
| `payroll.assistant.billReview`         | Old employee tool reply; reply text could become notes | Native background conversation with only the existing reconciliation and note tools; validated structured summary is an execution result, never guessed text to save |
| Vendor-bill task record                | Old conversation ID on success                         | Native conversation ID in the same existing task field on success; no new map, table or migration                                                                    |
| Feishu/IM reply, session map and cards | Closed compatibility path                              | Native realtime sessions, existing per-user/provider/route memory map, server-bound native approval cards and the existing signed callback                           |

The retained `vendorBill.aiEmployee` setting still opts into review but no longer selects an old employee/model. Official model services supply the model. An unset opt-in continues to notify without generating notes. No configuration or transcript is migrated.

The native bill scope persists its admitted bill ID in official scope configuration, derived from trusted server business context. Both tools reject scoped credentials before refreshing identity; they check current view/upload actions and the original services' row/field policies. A model argument for another bill is refused before either business service. The tool list offers no confirmation, amount/line editing, mail or external message action. The employee chat's global tool set stays unchanged.

Billing tools retain their existing ALLOW semantics; there is no human approval wait in this background operation. Its 120-second model budget uses the previously validated finite observer and awaited cancellation/finalization. This budget is not a policy for an idle realtime conversation awaiting human approval.

After generation, the task refreshes its owner's authorization before reading/saving notes. Missing configuration, invalid output and immediate provider failure retain the existing rule fallback. If a tool already saved notes before a timeout/cancellation, the task keeps them instead of writing a second fallback note. Withdrawn access also blocks the fallback. Existing event deduplication prevents a repeated upload trigger from starting another model or writing another note.

The old text-route parser remains a historical helper for existing isolated compatibility tests; production routing no longer invokes it or `fromText`. The IM channel no longer binds `createAIRunner`; no production factory call remains. Old runtime/history, Knowledge and legacy-tool consumers still prevent deletion of their shared modules/dependencies.

## Verification and limits

- Actual application composition, SQLite, native SDK and a loopback HTTP model execute the production classifier and bill task connection. There is no real Feishu send, external configuration access or credential read.
- Routing covers valid output, no model, invalid output, immediate model failure, unsupported restricted credentials, revoked use and audience filtering. A model cannot select or see an unauthorized routing row. Invalid plain text uses the keyword rule rather than becoming a guessed structured success.
- Real bill tasks cover read/save/final structured result, missing configuration, invalid output, immediate provider failure, revoked access before saving, and timeout/explicit Stop after saving. Each accepted task writes notes once; confirmed state, original lines and amounts stay unchanged. Reopened native results do not run another model, another user cannot restore the session, and duplicate upload triggers do not repeat the write.
- Direct restricted bill entry rejects before model probing or storage. Raw native read/write tools reject restricted credentials before either business method; a different bill argument also calls neither method. These admitted rejected tool turns still persist native errors and continue the model.
- Related four-file selection: **81 passed / 1 failed**; native composition has **65 passing cases**, including the prior 47 chat/learning/settings/scope/deadline cases. The only failure remains the active notification-management page assertion previously confirmed on older heads.
- Existing vendor-bill upload/reconciliation/export/permission behavior passes its filtered payroll case (1 passed / 25 filtered out). Retained card/transport suites have 22 passing cases; these exercise retained behavior only and are not evidence of native card cutover. The final five-case ownership/tool selection also passes (5 passed / 60 filtered out).
- The counts above describe the preceding routing/bill delivery. Native IM/card validation and current combined checks are recorded below. Unverified: real Feishu tenant, external providers, production HR/Jobs/PostgreSQL, all scheduling chains, installed-database checksum/backup recovery and the incomplete full template merge. Install/full build/full application browser acceptance were not repeated in this server adapter unit.

## Observed complete-operation costs

Counts exclude setup/assertions. They include native persistence and existing authorization, task and notification work. Fixture sequence/caches and asynchronous notifications affect reads/writes; these are observed operations, not fixed production budgets. No new application polling, runner claim, retry, lease, lock or coordinator is added.

| Operation                                                  | Models | SELECT | INSERT | UPDATE | DELETE | Transactions |
| ---------------------------------------------------------- | -----: | -----: | -----: | -----: | -----: | -----------: |
| Route valid / invalid / provider failure, each             |      1 |     68 |      3 |      6 |      0 |            4 |
| Route no model                                             |      0 |     16 |      0 |      0 |      0 |            0 |
| Route restricted entry                                     |      0 |      0 |      0 |      0 |      0 |            0 |
| Route revoked                                              |      0 |      2 |      0 |      0 |      0 |            0 |
| Route unauthorized model key                               |      1 |     74 |      3 |      6 |      0 |            4 |
| Bill read, save and successful result                      |      3 |    235 |      8 |      8 |      0 |            6 |
| Bill duplicate trigger                                     |      0 |      2 |      1 |      0 |      0 |            0 |
| Bill no model, rule fallback                               |      0 |     99 |      5 |      2 |      0 |            2 |
| Bill invalid result, rule fallback                         |      1 |    205 |     12 |     16 |      0 |           10 |
| Bill provider failure, rule fallback                       |      1 |    178 |     10 |     12 |      0 |            8 |
| Bill revoke before save (including injected revocation)    |      3 |    173 |      6 |     12 |      1 |            7 |
| Bill timeout after save                                    |      3 |    237 |      8 |      8 |      0 |            6 |
| Bill explicit Stop after save                              |      3 |    236 |      8 |      8 |      0 |            6 |
| Bill restricted entry                                      |      0 |      0 |      0 |      0 |      0 |            0 |
| Raw restricted bill read / write, each (creation excluded) |      2 |     40 |      2 |      6 |      0 |            3 |
| Raw different-bill tool (creation excluded)                |      2 |     46 |      2 |      6 |      0 |            3 |

The bill success uses three model requests: read-tool proposal, save-tool proposal and final structured result. Its tools do not require an approval continuation. Duplicate trigger's insert is the existing skipped-run audit, not a bill write. The revocation scenario includes the controlled permission-assignment removal inside its measurement; that DELETE is not performed by review itself. Timeout/cancellation reads and writes include native terminal persistence; a saved note is not rolled back or replayed. A later filtered ownership/tool capture has different cache/notification boundaries (for example invalid bill 178 SELECT instead of 205); it is not a performance improvement. Separate captures are not added together. Native task failures still may lack a task-side conversation ID even though the native failed session is persisted; this existing tracing boundary is unchanged.

## Delivered native IM sessions and approval cards

The approved minimal mapping is implemented in existing card payloads. No new tables, columns, migrations, persistent channel directory or authorization policy are introduced. Historical business cards keep their handlers and data.

- A native waiting profile-change tool produces one card with the four IDs from official assistant/execution metadata and masked display. Neither the callback nor model input supplies those IDs. The tuple-based hashed dedupe key includes provider, recipient and all four IDs.
- The callback retains its signature, timestamp, `cardId/button`, recipient and event deduplication checks. A native card additionally requires its original external addressee to remain bound in both directions to the current user. Restore checks native ownership and saved channel origin. The exact pending tuple is matched before official atomic `approve`, which also checks waiting state and expiry. Business tools resolve current authorization and current binding again.
- An approved profile tool calls the existing HR request service with trusted `feishuCard` source. It creates one pending HR-review request, never changes the employee record. Source identity comes from an internal server context, not tool parameters. In-app submissions and historical cards retain their existing source and behavior.
- Accepted decisions remain accepted if the following model turn, send or card update fails; callbacks cannot replay the business tool. This keeps existing at-most-once processing semantics; no automatic redelivery/recovery has been added.
- The existing user/provider/route memory map holds native IDs and their verified external addressees. Restore reads native history without resending input. Referring followups reuse the conversation; while waiting they return the same card without adding a user turn. A fresh channel instance can restore a pending card from payload. The test recreates the channel service/clears its maps while retaining the same application and OnlineAgent; full process restart is unverified. New messages after service recreation start a new conversation.
- Creation alone supplies trusted business context. Adding that context on restore would append a new user message after the SDK approval response and prevent continuation; actual composition tests caught this and the adapter now omits it on restore/approval.
- Live model responses have a 120-second cancellation budget and awaited abort/finalization. The timer is cleared when the response closes for approval; waiting for a person follows official approval expiry. Expired/stopped cards are refused by native state; the historical application card can remain visually open. No extra expiry cleanup or recovery design is introduced.
- Native services are resolved lazily by the HR channel to respect plugin boot ordering. Old standalone HR suites initially exposed shutdown hook timeouts with eager resolution; the lazy binding removes that lifecycle-order issue without changing runtime lifecycle implementation.

### Verified behavior and boundaries

- Native composition: **83 passed**, including all prior 65 cases. The added matrix covers approve/reject, simultaneous and repeated callback IDs, all four incorrect IDs, wrong user/rebinding, revoked use, expiry, stopped execution, failed continuation, channel-service recreation/old-card restore, restricted entry, masking/read/followup/pay routing and live-stream timeout.
- Approve/reject traverse the real signed HTTP callback. Missing signatures and stale timestamps are refused. A 25-hour Date shift tests official expiry; a 300 ms response budget tests actual HTTP stream closure and native idle/cancelled state. No multi-minute CI wait or production scheduler runs.
- The actual Feishu transport runs against a controlled local message API with production-equivalent external-message-ID SQL. One card is inserted/sent, the ID is written back, approval writes one HR request, then one text and one card PATCH are emitted. No tenant credentials are read and no real user receives a message.
- The final six-file related selection: **122 passed / 1 failed**, solely the retained notification-management assertion. The native file passes all 83 cases. The isolated attendance after-turn hook passes (part of a 10-case lifecycle-order selection); its response facade tests the business hook only, not native protocol acceptance. Older fake-runner channel tests were replaced by the real native cases; historical card/transport behavior remains exercised.
- A separate component test renders the actual English backend card view through the existing mock card component and verifies Reject needs no business rejection comment. The attached English screenshot is this controlled component rendering, not a full application or real Feishu screenshot. No client production source changed.
- External Feishu/model interoperation, production HR/Jobs/PostgreSQL and persistence-outage recovery remain unverified. Knowledge retrieval/embeddings and HR-space authorization remain a separate AI integration; the IM prompt explicitly directs unsupported tools to NocoHR. Legacy history remains readable; no configuration/transcript migration occurs.

### IM costs from complete, separate measurements

Counts include existing authorization, native persistence and business work, but exclude fixture setup/assertions. Query counts are attempted statements: a duplicate-event INSERT fails its unique constraint and creates no row. The table below is from the final combined selection (83 native cases); caches/notification timing can change reads. No counts from separate operations are summed into a fixed budget.

| Operation                                                  | Models | SELECT | INSERT attempts | UPDATE | Transactions | Card/text/PATCH sends |
| ---------------------------------------------------------- | -----: | -----: | --------------: | -----: | -----------: | --------------------- |
| Propose profile change, route included (cold approve case) |      2 |    183 |               8 |     10 |            7 | 1 / 0 / 0             |
| Approve via signed callback, includes actual HR write      |      1 |    157 |               6 |     11 |            6 | 0 / 1 / 1             |
| Reject via signed callback                                 |      1 |     77 |               1 |      7 |            2 | 0 / 1 / 1             |
| Duplicate incoming/callback ID, each                       |      0 |      0 |        1 failed |      0 |            0 | 0 / 0 / 0             |
| Different callback ID after handled                        |      0 |      9 |               1 |      0 |            0 | 0 / 0 / 0             |
| Followup while awaiting approval                           |      0 |     41 |               1 |      0 |            0 | 0 / 0 / 0             |
| Controlled real Feishu adapter: propose/deliver            |      2 |    158 |               8 |     11 |            7 | 1 / 0 / 0             |
| Same adapter: approval/continuation/HR write               |      1 |    158 |               6 |     11 |            6 | 0 / 1 / 1             |
| Continuation model failure after approved HR write         |      1 |    157 |               6 |     11 |            6 | 0 / 0 / 1             |
| Live-response timeout, creation excluded                   |      1 |     35 |               2 |      4 |            2 | 0 / 0 / 0             |
| Unsupported restricted IM entry                            |      0 |      0 |               0 |      0 |            0 | 0 / 0 / 0             |

All listed branches issue no DELETE. A revoked callback used zero models, 18 SELECTs and one deduplication INSERT; a rebound/wrong user used two SELECTs and one INSERT. An expired callback used zero models, 42 SELECTs, one INSERT and one attempted UPDATE, with one transaction begun and none committed. These rejection costs are independent of initial card creation. The timeout-only capture had 33 SELECTs versus 35 in the combined run; writes are unchanged, so this is not an optimization claim. Table-level captures in the delivery attachment separately attribute card storage, deduplication, native storage and business requests:

- Propose: `imCards` has one INSERT and two SELECTs; deduplication has one INSERT. Native conversations have 21 SELECTs, two INSERTs and ten UPDATEs; messages have eight SELECTs and four INSERTs. No business request is written. The controlled real transport adds one card UPDATE for its external message ID.
- Approve: card storage has three SELECTs and one UPDATE; deduplication has one INSERT. Native conversations have 12 SELECTs/four UPDATEs and messages six SELECTs/two UPDATEs. The HR request table has one SELECT and one INSERT; other HR/audit/authorization work is included in the overall total rather than omitted. Employee data is read, not changed.
- Reject has the same native/card-state work, one callback-event INSERT and no HR request. Duplicate event IDs attempt one event INSERT only; a fresh late callback ID writes its own event but cannot repeat native approval or HR work. Failed sends retain the existing at-most-once delivery boundary.

Prior routing/bill costs above remain separate historical captures. Native failure sessions can still lack a task-side conversation ID; notification failure and this existing tracing boundary are retained. Production activation, Knowledge, Workflow, installed-database checks/backup restore and full template reconciliation remain separate gates.

## Expired approval and verified rebinding

A new authorized input can now start a usable conversation after its cached approval expires or its legitimate external binding changes. Old native executions, business records and cards remain intact; the new turn does not resend old input or approve an old tool.

- Before reuse, a changed external sender must resolve to the same current NocoHR user and match the reverse binding; current chat-use authorization is checked before any replacement. Other restore/ownership/configuration errors propagate without clearing the map or retrying admission.
- Public `status()` reports occupancy but does not expose approval expiry in Agents `.18`. When public history contains approval candidates, a read-only adapter fetches existing metadata v1 with an owner-filtered Repository query, matches the current execution/message, and checks the official `approvalExpiresAt`. No candidate means no added metadata query. Unknown/incomplete state fails closed. This fixed-version metadata boundary must be reconciled on a future Agents upgrade.
- A confirmed expired wait releases only the cached reference; the old execution/history is neither stopped nor rewritten. A new conversation uses only the newly authorized input. A currently valid wait still returns its original card without a new model call; the official atomic approval remains authoritative if state changes between reads.
- The two independent fresh-message regressions fail on `8677cb3`: one returns the original expired card and the other throws FORBIDDEN after legal rebinding. They pass after the fix. Expanded assertions cover a real profile read in the new session, preserved old history/metadata/card and no HR writes; revoked users cannot reach native admission. An injected generic restore denial is propagated unchanged, and a later valid input still reuses its cached session.
- This fix selection has **111 passed** across native composition, historical cards, transport and components; the native file retains **83 passing cases** with expanded assertions in the two previously failing matrix entries. Existing approve/reject, deduplication, ownership, cancellation and human-wait regressions pass. The preceding 122 passed / 1 failed selection is historical evidence; its known notification assertion was not rerun or reclassified. Failed-task tracing retains its existing boundary. No page, install or full build was repeated.

### Incremental cost

The added expiry query is one SELECT only when history contains a candidate approval, including the card proposal and a followup during human waiting. It adds no write, transaction, model request, poll or runner operation. Confirming a changed binding adds one reverse-binding SELECT on that branch. New conversations then incur their ordinary native/model/persistence costs; these are not free recovery operations.

| Complete operation                                             | Models | SELECT | INSERT | UPDATE | Transactions |
| -------------------------------------------------------------- | -----: | -----: | -----: | -----: | -----------: |
| New profile-read input after expiry, routing included          |      3 |    194 |      7 |     10 |            7 |
| New profile-read input after legal rebinding, routing included |      3 |    185 |      7 |     10 |            7 |
| New input after either condition while use is revoked          |      0 |      9 |      1 |      0 |            0 |
| Injected ordinary restore denial, each                         |      0 |     30 |      1 |      0 |            0 |
| Valid pending followup                                         |      0 |     42 |      1 |      0 |            0 |

These branches issue no DELETE. The two successful fresh-input operations use one classifier request, one profile-tool proposal and one final answer. Native conversation storage has two INSERTs (classifier plus replacement conversation); message storage has four INSERTs. The other INSERT is existing incoming-event deduplication. No card or HR request is inserted or updated. Revoked/denied branches have no native conversation/message writes; their one INSERT is event audit. A valid wait's extra SELECT is visible against the previous 41-read capture, with no added writes/model requests. The proposal now observes 184 SELECTs versus 183 previously, with the same writes; signed approval remains 157 SELECT / 6 INSERT / 11 UPDATE / 6 transactions and one model request. Cache/async variation is not a performance gain.

Measured complete fresh-input and denied branches are recorded with the delivery's cost JSON. Model/SQL totals include routing, existing deduplication, native conversation/messages and business authorization; fixture permission removal/reassignment and assertions are excluded. Original approval/bill costs above are historical captures, not a fixed budget or an additive estimate for this fix.

## Reproduce

```bash
# Current invalidated-session fix selection (111 passing cases):
pnpm exec vitest run tests/logic/native-ai.test.ts tests/logic/v1-feishu-cards.test.ts tests/logic/feishu-bot.test.ts tests/components/im-cards.test.tsx --disableConsoleIntercept
# Historical wider routing/bill checks; notification assertion remains a known failure:
pnpm exec vitest run tests/logic/native-ai.test.ts tests/logic/assistant-model-business.test.ts tests/logic/plugin-page-authz.test.ts tests/logic/ai-entry-route-text.test.ts --disableConsoleIntercept
pnpm exec vitest run tests/logic/v2-payroll.test.ts -t 'V2-06 vendor bill' --disableConsoleIntercept
pnpm exec vitest run tests/logic/v1-feishu-cards.test.ts tests/logic/feishu-bot.test.ts tests/components/im-cards.test.tsx --disableConsoleIntercept
pnpm exec vitest run tests/logic/v2-attendance-feishu.test.ts -t 'day-5 leave drafted' --disableConsoleIntercept
pnpm exec tsc -p tsconfig.server.json --noEmit
pnpm exec vitest run tests/logic/agents-md.test.ts
```

The first command retains the known failing notification assertion. For only the new IM cases, filter `native-ai.test.ts` with `native IM|restricted IM|native card delivery`. The complete native file is the definitive protocol regression set. All 138 historical migration/seed sources, application manifest/lock, fixed template `.76` / Skills `.44`, compatibility/process defaults, preflight and source marker `.54` stay intact.
