# Model and business consumer integration unit

The supported Completions configuration now reaches the existing conversation service, learning-plan task, certificate brief and Feishu channel under the fixed server SDKs. A plain-text structured answer no longer crashes before schema validation. This unit does not authorize runtime cutover.

- Keep the complete upgrade PR in draft: dependency resolution, deployed capability/configuration inventory, original history archives and full application acceptance remain incomplete.

## Behavior verified

- Configuration selects the employee's permitted model, passes endpoint and sampling options to real ChatOpenAI, and publishes metadata without credentials or endpoint. Disabled services, missing keys and the legacy Responses provider name remain unavailable; no provider is renamed or silently substituted.
- Real LangGraph turns persist streamed text and assemble split tool arguments with their original call id. Completed tools are not replayed. Approval and rejection continue with saved tool results; revoked access prevents decisions, and ownership prevents another user continuing a session.
- Structured background work offers only the SDK's output-format function, never business tools. Valid, invalid, malformed JSON and plain-text answers follow schema/fromText validation. A new structured session gets at most two attempts; an existing session gets one. Provider failures and cancellation propagate rather than becoming configuration failures.
- The existing gap-plan task reads employees through its owner's repository policy. A person outside that policy does not enter the prompt. The actual plan service writes a draft, leaves assignments empty and records the draft hash. Missing models or two invalid answers retain the existing rule fallback; provider failure writes no plan.
- Weekly briefs use the head's supplied facts, cap output at 200 characters and retain the existing empty/invalid/provider-failure fallback. The facts service and notification delivery are synthetic boundaries; this verifies prompt scope and output handling, not factual compliance of an external model. The old brief's two certificate tools are not equivalent to the new facts-only branch.
- Feishu uses the actual routing service, runner and channel. Routing and reply requests are counted separately. Follow-ups reuse history; ASK clears the cached channel session. Profile changes produce an open masked card without invoking the change service or approving the pending tool. Other ASK calls link back to the application's confirmation path. Pay questions reach routing but never the reply model; mobile and identity numbers are masked in replies.

## SDK adaptation

`ChatOpenAI.withStructuredOutput(..., { includeRaw: true })` can return `parsed: undefined` for a plain-text answer. The adapter previously tested only `null`, serialized `undefined`, then constructed `AIMessage(undefined)`, throwing a TypeError before the runner could validate or apply `fromText`. Treating both missing parsed values alike sends the original text to the existing runner. The retry policy, schemas, transport, storage and authorization are unchanged; provider exceptions are not caught or wrapped by this change.

The new structured regression fails against `95e12af` at that TypeError with the same fixture and SDK lock. It passes with this correction. Its baseline filtered run has 17 skipped tests solely because of the name selector; the final seven-suite run has no skips.

## Measured existing costs

These are observed SQLite statements for synthetic fixtures, including repository metadata reads when first encountered. Each row measures exactly the named action; rows within one test can reuse metadata. They are not deployment timings or universal warm-query budgets. Synthetic permission resolution, facts, notification sending and business tool effects contribute no database statements, so production costs can be higher. The task handler is invoked directly; scheduler/claim accounting is outside the measurement.

| Action                                  | Model HTTP | SELECT | INSERT | UPDATE | BEGIN / COMMIT |
| --------------------------------------- | ---------: | -----: | -----: | -----: | -------------: |
| Employee default selection              |          0 |      1 |      0 |      0 |          0 / 0 |
| Background text                         |          1 |     37 |      3 |      2 |          3 / 3 |
| Structured success                      |          1 |     37 |      3 |      2 |          3 / 3 |
| Structured invalid then valid           |          2 |     49 |      6 |      4 |          6 / 6 |
| Learning gap-plan success               |          1 |    119 |      4 |      2 |          3 / 3 |
| Learning unavailable fallback           |          0 |     83 |      1 |      0 |          0 / 0 |
| Learning invalid fallback               |          2 |    143 |      7 |      4 |          6 / 6 |
| Learning provider failure               |          1 |     85 |      2 |      2 |          2 / 2 |
| Brief success or empty fallback         |          1 |     38 |      3 |      2 |          3 / 3 |
| Brief invalid fallback                  |          2 |     62 |      6 |      4 |          6 / 6 |
| Brief provider failure                  |          1 |     29 |      2 |      2 |          2 / 2 |
| Brief unavailable fallback              |          0 |      2 |      0 |      0 |          0 / 0 |
| Feishu routing + automatic tool + reply |          3 |     95 |     10 |      6 |          9 / 9 |
| Feishu follow-up                        |          1 |     25 |      3 |      2 |          2 / 2 |
| Feishu routing + ASK                    |          2 |     76 |      8 |      4 |          7 / 7 |
| Feishu profile card after follow-up     |          2 |     59 |      8 |      4 |          6 / 6 |
| Feishu pay routing, no reply            |          1 |     47 |      4 |      2 |          3 / 3 |
| Approval / rejection                    |          0 |      7 |      0 |  4 / 3 |          0 / 0 |
| Resume after either decision            |          1 |     24 |      2 |      2 |          2 / 2 |

No DELETE statements occurred. The production change adds no HTTP call, SQL, persistent write, lock, transaction, polling or runner claim. It repairs a previously crashing answer within the existing bounded attempt path; an invalid plain answer can now reach the already-intended second attempt. Existing SDK retries remain disabled (`maxRetries: 0`). Configuration boot continues to read the existing service table; this fixture constructs the model catalog directly and does not measure complete Provider boot.

## Validation and limits

- Seven selected assistant/model/consumer suites: 143 tests passed, including 18 new integration tests. Adapter-scoped TypeScript, changed-file ESLint, formatting and diff checks passed.
- The extended test/consumer TypeScript graph remains blocked by the unavailable retained AI plugin and omitted packages in the partial tool installation. It is not a passing application typecheck. The same 52 normalized diagnostics occur against `95e12af` with the same extended test graph and tool installation; none points to a changed file. No local declarations or framework shims were used to hide these failures.
- Real components: fixed `@langchain/core@1.1.49`, `@langchain/openai@1.4.7`, LangGraph `1.4.4`, ChatOpenAI, application adapter/turn/conversation stores/tool ledger, runner, routing service, task handler, plan service, brief function, channel and card renderer. SQLite executes selected original application migrations in memory.
- Synthetic boundaries: loopback model HTTP responses, actor/grant resolution, business tool effects, organization/head lookup, weekly facts, notification delivery, Feishu transport and profile-change service. No actual provider credentials, HR records or tenant network are used. Cancellation is checked at the SDK/service boundary and durable session state; it does not roll back already-executed business.
- Unverified: complete application install/build/start, real sign-in and HR grants, real model output, actual Feishu confirmation callbacks and notification delivery, deployment configuration/history equivalence and browser screenshots. No UI changed.

## Preservation and next gates

The template target stays `.74`, Skills `.42`, and completion marker `.54`. All 138 migration/seed sources, application lock/manifest, old registrations, closed runtime switches and preflight blocks are retained. The application-local Skills remain unsynchronized; the exact published `.42` package reference and an independent tool lock were used. The tool graph is not the application installation.

Continue with de-identified deployed provider/model/employee/task settings and historical migration/seed archives. Credentials must be bound by the deployment owner in an authorized test environment, never attached. Responses/other providers, special credentials, attachments, knowledge, skills/MCP and Workflow inventory remain separate gates. Complete those mappings before native package removal and application lock generation, then build/start and verify the real application. See [the integration record](template-integration.md).
