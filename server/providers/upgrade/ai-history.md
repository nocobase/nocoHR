# Retained AI history and configuration

The mapper targets `@nocobase/app-plugin-ai-employee@1.0.0-beta.30`, the version pinned by this application. The public registry has no tarball for that exact package/version. Its [official release source at 6f38530](https://github.com/nocobase/nocobase3/tree/6f38530/packages/plugins/app-plugin-ai-employee) declares `.30` and supplies the table, message, model-resolution and permission contracts used here. This is source-contract evidence, not an archive of the installed compiled package. The original package, compiled migration manifest and checksum comparison remain separate cutover prerequisites. Public `@nocobase/ai-employee@0.2.0-beta.8` is a different package; it does not substitute for that archive.

## Mapping and authorization

Migration `202610270034` adds only approved application-owned employee, preference, model-metadata and file-reference tables. Existing conversation/message/tool tables and the migration ledger are reused. No historical migration, plugin table or file is changed. Schema rollback refuses populated target tables.

| Retained source                 | Application copy                               | Preserved behavior                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiEmployees`                   | `assistantEmployees`                           | Username, display fields, prompt mode, tool selection, enablement, model restrictions and ordering. Application declarations remain the tool implementation boundary.                              |
| `usersAiEmployees`              | `assistantEmployeePreferences`                 | Owner-scoped employee choice/order and personal prompt. Prompt modes `raw` and `none` do not apply the personal modifier.                                                                          |
| `llmServices`, `aiSettings`     | `assistantModelServices`                       | Curated model lists, enabled state, selection mode, default model, endpoint metadata and supported sampling parameters. Old API keys are excluded; execution requires server configuration.        |
| `aiConversations`, `aiMessages` | Existing assistant conversation/message tables | Original session/message IDs, owner, employee, title, text, tool-call identities, metadata and attachment references. IDs remain strings, including values beyond JavaScript's safe integer range. |
| `aiToolMessages`                | Existing assistant tool-call table             | Completed results and confirmed rejections remain terminal. Unexecuted calls require a fresh decision, including an old saved approval. No old graph checkpoint is replayed.                       |
| `aiFiles`                       | `assistantFiles` references                    | Original uploader, disk, path and file identity. No byte copying, moving or deletion.                                                                                                              |

The enabled page service uses application routes for both copied and retained history. The retained reader uses physical table queries and works after legacy Collection metadata is removed. An uncopied session is read-only; copying is never triggered by a page read or application boot. A copied completed session can accept a new message using its original ID. A copied undecided group uses the existing decision and continuation interfaces. Completed tools never execute again on continuation or copy replay.

Every route requires the application's existing assistant permission and session ownership. Business actions retain their own current authorization. File reads require the original uploader or a fresh native `ai.settings/access` permission check, including during continuation; role names and caller-supplied root flags do not grant access. The preview route streams the original drive object with a sandbox CSP and `nosniff`. Missing files do not reveal existence to unauthorized users.

Only `openai-completions` is currently mapped. The old `openai` provider uses Responses and cannot be silently aliased to it. Server configuration supplies the key and can override endpoints/options. A copied database-curated model list remains authoritative unless `overrideEnabledModels` is explicitly configured. Employee model restrictions intersect the current enabled catalog; background calls retain employee choices or global defaults. The public roster/model response exposes no system prompt, key or endpoint. Missing keys prevent execution but do not prevent owned history reads.

Retained attachment URLs point at the application preview route. Plain UTF-8 text files up to 128 KiB are loaded as untrusted document context when continuing a copied conversation. Other formats retain their history references but raise an explicit parser error on model continuation. New uploads and general document parsing remain unimplemented capabilities and block cutover where required.

## Explicit bounded copies

Run against an independent backed-up test database first. Stop legacy writers and drain active calls before the final copy. These commands are application CLI entry points; they register providers and connect the database without starting the application or background workers. The complete CLI composition still needs verification with the restored application dependencies.

```sh
pnpm nocobase app migrate-assistant-history --source-version 1.0.0-beta.30 --configuration
pnpm nocobase app migrate-assistant-history --source-version 1.0.0-beta.30 --preferences --user <user-id>
pnpm nocobase app migrate-assistant-history --source-version 1.0.0-beta.30 --session <session-id> --user <owner-id>
```

Copy configuration before preferences/transcripts. Supply keys through server configuration, using fake keys in tests; do not import or export deployment credentials. Configuration is bounded to 200 employees and 200 model services plus one settings record; preferences to 200 for one owner; a transcript to 1,000 messages and 1,000 tool rows. Larger units fail before committing and need a separately scoped batching decision. There is no global user/session scanner.

Each unit uses one outer transaction and the existing per-record ledger savepoints. A source digest plus target identity makes replay idempotent, preserves newer target state and detects changed sources or missing targets. The conversation digest also freezes its message/tool/file set. A mid-copy failure rolls back every target and ledger row in that unit. Distinct sessions sharing one file reuse its target through the ledger. File reads/checks do not write storage.

For existing employee rows, tool mapping follows `.30`'s `getAIEmployeeTools` and `isToolSelected`: discover registered GENERAL tools plus names in `skillSettings.tools` / `enabledTools`, then intersect with `enabledTools` when it is an array (including an empty array). Missing or empty selections never fall back to code-declared SPECIFIED tools. Code defaults still apply when there is no copied employee profile, as on a new installation. Presets affect automatic execution only for CUSTOM tools; other scopes retain the registered default policy. Unsupported tool implementations and session/skill/system capabilities remain cutover gates.

This mapper fix affects first copies only. A profile already copied with an incorrect tool set has the same source digest, so the ledger deliberately returns `unchanged` and preserves that profile, just as it preserves later administrator edits. Re-running configuration does not repair such profiles. Keep the replacement entry disabled until previously copied profiles have been compared with their source selections and any correction has been separately authorized; do not clear ledger rows or overwrite target profiles automatically. No historical migration or source row is changed by this fix. The required metadata count `ai.unverifiedToolProfiles` includes every previously copied profile whose effective tools, automatic policy and subsequent administrator edits have not been reconciled; a positive count blocks preflight.

The runtime still requires a code-declared ALLOW policy before automatic execution. A legacy CUSTOM tool with default ASK and a saved autoCall=true therefore remains more restrictive after copying, even though the copied flag is retained. Count such unresolved combinations in `ai.autoPolicyDifferences`; a positive count blocks preflight until the behavior is adapted or a separate behavior change is decided. This process unit does not alter tool execution policy.

Unknown source fields in mapped employee configuration, unsupported providers, skills/MCP/knowledge/data-source capabilities, work context, incomplete messages, active/uncertain calls, edited pending arguments, unmatched tool results, missing owners/files and unsafe paths fail explicitly. The metadata preflight still reports both replacement capabilities unverified: these mappings alone cannot authorize a deployment switch. Installation inventory, unsupported attachments/flows, real authentication and complete provider composition remain cutover gates.

## Cost and evidence boundary

Ordinary owned target history keeps its three logical reads and no writes. Retained history adds target lookup, ownership/source/message/tool reads, and one file-reference/source lookup per attachment reference; there are no writes. Roster adds two reads for profiles and that user's preferences. Runtime preparation adds two reads for the selected profile/preference; current tool authorization additionally reads the profile so revocation and disabled tools are checked afresh. Background default selection reads the profile and, when unrestricted, the copied defaults. Prompt editing uses one owner-keyed upsert. Continuation reads each distinct attached file once and uses a per-request text cache. Model metadata is read once at provider boot; there is no polling.

The SQL trace in the isolated verification records cold and warm counts, including database-library metadata queries and ledger savepoints. It excludes real authentication, HR business queries and remote model latency. The representative measurements below use one employee/service/defaults record, one user preference and a two-message transcript without attachments or tool calls:

| Operation                                      |       SELECT | INSERT | UPDATE | Outer transactions | Ledger savepoints |
| ---------------------------------------------- | -----------: | -----: | -----: | -----------------: | ----------------: |
| Configuration copy (3 records)                 |           46 |      6 |      0 |                  1 |                 3 |
| Preference copy (1 record)                     |           20 |      2 |      0 |                  1 |                 1 |
| Transcript copy (3 records)                    |           50 |      6 |      0 |                  1 |                 3 |
| Configuration / preference / transcript replay | 46 / 20 / 50 |      0 |      0 |             1 each |         3 / 1 / 3 |
| Retained history, cold / warm                  |       13 / 5 |      0 |      0 |                  0 |                 0 |
| Copied history, cold / warm                    |       11 / 3 |      0 |      0 |                  0 |                 0 |
| Roster, cold / warm                            |       10 / 2 |      0 |      0 |                  0 |                 0 |
| Send into copied completed session             |           22 |      2 |      2 |                  2 |                 0 |

The test authorization functions are synthetic; additional reads from the production authorization/profile callbacks are excluded, as are business queries. Migration scales with source rows, tool groups and distinct files, with one target insert and one ledger insert per newly copied record; replay performs validation/reads/savepoints and no target writes. No leases, heartbeat, automatic replay, explicit application lock or takeover mechanism is added.

Tests use synthetic legacy rows matching the official source contracts, actual SQLite, the real migration ledger, history decoder, runtime service, HTTP routes and executor. A fresh manager reads physical retained tables without old Collection metadata. They check immutable source rows/files and a historical-migration sentinel, exact bigint IDs, owner isolation, rollback, replay, re-confirmation, completed/rejected tool preservation, model restrictions and business failure events. A real LangChain adapter uses a local synthetic completions endpoint and fake key. The sentinel is not proof of the installed historical migration loader or compiled checksums. These checks do not replace repository tests, actual login/policy composition, a running browser screenshot, build or strict source/compiled startup.
