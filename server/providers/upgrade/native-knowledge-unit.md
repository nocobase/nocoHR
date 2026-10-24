# Authorized dual-source knowledge search

The approved search stage is implemented: HR documents keep their original keyword search, management, review, versions and references; native Knowledge is a separate authorized source with its official reader/editor, storage, chunk index and vector queue. Independent review is pending. The complete upgrade remains a draft and cannot merge or deploy.

Persistent knowledge Q&A is deferred until the official contract can recheck the current permissions of complete conversation history before a model call. No body/search tool is added to employee chat or IM. Other native chat, ordinary generation and approval integrations remain in place.

## Authorization and source boundaries

- HR search intersects current `knowledgeAssistant/use` and `kbDocument/view` repository policies **before** selecting document bodies. Existing visibility, source eligibility, supersession, translations, drafts, conflict citations and references remain.
- Native spaces default to none. Only declared spaces exist to the application resolver. Current HR knowledge-use admission and an explicit native `kb.knowledge/read.*` grant are both required. `*.related` also requires explicit configured user membership; `*.all` is an administrator's explicit grant across configured spaces. Membership alone grants nothing; no legacy permissions are copied.
- Native node permissions retain the official narrowing/widening mechanism **inside** an admitted space. A hard refusal precedes that mechanism, so a custom node grant cannot bypass missing HR use, missing native read or removed related membership. Current grants are rebuilt per operation; actors are refused while persistent knowledge-agent use is closed.
- The official HTTP route factories are retained, including their schemas, versions, files, proposals, upload tickets and atomic ticket behavior. A narrowly scoped application wrapper authenticates the original entry and refuses `identity.keyScope` before constructing a user reader. The aggregate service also refuses restricted or mismatched identities before rebuilding subjects.
- Both the facade and the official reader search refresh each hit's native authorization/version after awaiting retrieval; the facade also refreshes the directory. HR retrieval runs afterwards with fresh use/view policies. Deployment membership is never spread into public space references. Only authorized document authors' names are resolved; search/space responses return no email, model key or deployment membership list. The authorized native permission picker separately lists configured related users.
- The official ticket redeemer rechecks its stored reader. A revoked ticket can incur native staging/cleanup writes before refusal; it produces no proposal or model call. No new ticket/callback protocol or coordinator is introduced.

## Index and presentation

- Official `chunks.changed` notifications read administrative current chunks and call `vectors.collection.replace`. Stable `docId:ordinal` IDs retain embeddings across chunk-ID/version changes when text is unchanged; current chunk/version/gate metadata is replaced. Archive removes derived entries while preserving source/version history.
- The vector provider sends one query embedding and applies **space ID and current native gates in the actual vector WHERE before topK**. Official Knowledge validates returned chunks and current versions against the search's captured gates before fusing rankings; the application refreshes authorization again before returning hits. There is no document-text reranker or knowledge-answer model call.
- The indexer uses official states/unfinished/reindex APIs. Reindex invokes official `sync` before replacement: model or dimension changes rebuild the derived collection, then retire the previous index. A deployment model change requires this explicit official Reindex action; there is no new watcher, poll, scheduler, lock, claim, lease or retry policy.
- Missing models, unavailable indexes or failed query embeddings retain native contains search and report semantic unavailability in the aggregate UI. Each source has its own availability; missing HR view affects only HR results. Scores and identifiers are not merged across corpora.
- The existing knowledge page adds **Search sources** with an explicit submit, separate result groups, source/version references and authorized native-space links. Official `KnowledgeView` provides the native tree, document, edit/proposal/history/file/permission surfaces inside that existing page. Its own search/index/realtime refresh behavior is retained. Existing HR list/detail/upload/version routes and page grant IDs are unchanged; default plugin routes are disabled.

## Verified and remaining

- Real standalone application, official SDK/services/migrations, SQLite and the actual sqlite-vec extension; local controlled HTTP embedding only. Nonempty synthetic HR/native documents exercise related spaces, native custom ACLs, current use/view intersections and direct body/version/file access.
- Restricted service contexts reject before subject rebuilding/SQL/embedding. A real native API key with a test-only page scope is refused by aggregate and direct HTTP paths. Production key scope declarations are unchanged. Revocation during embedding removes excerpts and directory metadata before response.
- Real file upload, worker text extraction and indexing pass. Revoked file/version/export-readable/ticket paths refuse access. Native source records survive archive/index removal and model/dimension rebuilds. Text-preserving title/version changes and explicit unchanged reindex do not request another embedding.
- Related six-file selection: **141 passed / 1 failed**. The failure in `knowledge-service.test.tsx` is the existing UnifiedAssistant fixture without AppClientRoot. An offline `5551307` snapshot with the same dependencies reproduces the same named failure and stack (1 failed / 3 filtered). The new composition suite passes **16/16**, including the final metadata-only/model maintenance cases; the new UI suite passes **4/4**.
- Chromium passes against the **real NocoHR routes and application shell**, native synthetic administrator login, fresh isolated DB/storage, controlled embedding and actual vector index. English screenshots cover grouped results, official versioned reader and 375px search. One submit makes one aggregate request; typing makes none. Startup's existing React script warning is recorded on the baseline Workbench; no new page/console error or external browser request occurs on knowledge navigation. All test services close afterwards.
- Client/server TypeScript, changed-file lint/format and documentation links are checked separately. No unrelated complete install/build or production channel is repeated. Known notification, login-return chat-service fixture and breadcrumb-language failures retain their previous baseline status; this step does not report those suites as passing.
- Unverified: real external embedding/model service, PostgreSQL/pgvector, multi-instance Jobs, persistent fault/restart recovery, and final whole-application installation/build/source/build-start/backup-restore acceptance. The local test proves actual vectors, not production embedding quality or operational deployment readiness. Native queue/worker behavior is reused without alteration.

## Current owner-confirmed environment scope

The owner confirmed on 2026-10-23 that no used old environment or existing production data exists. Old deployment definition inventories, old execution histories, installed compiled archives and old-database migration/restore evidence are **not applicable**, not passed. The previous presentation unit and process record now say so. All 138 historical sources remain intact. Actual new-environment business definitions/handlers/parameters, permissions/idempotence, strict installation/build/source-and-build startup and an isolated new-database restore drill remain applicable.

## Details: configuration, ownership and reruns

- Baseline `5551307`; template `1.0.0-beta.76`, Skills `0.1.0-beta.44`, Knowledge `0.1.0-beta.9`, Agents `1.0.0-beta.18`. Knowledge was already in the fixed dependency graph. `nocobase plugin register … --no-install` added composition entries; no dependency/lock/version change or new application migration was made.
- `server/config/native-knowledge.ts` / `config.example.yml`: explicit spaces, related user IDs and native embedding model reference. Nothing is public by default. Assign native business actions through the existing Roles/permissions management and configure the real model service through Settings → Models; do not put credentials into this configuration.
- `server/providers/native-knowledge/`: hard admission, retained official route factory, names/subjects, native source/indexer and dual-source facade. `server/routes/hr/learning.ts` adds documented validated `GET /talent/kb/search?q=` and authorized `GET /talent/kb/spaces`.
- Official plugin migrations own native `kb*` storage/files/tickets/snapshots. Agents owns model configuration, vector entry/index state, queueing and model usage. sqlite-vec owns a derived `storage/vectors.sqlite` by default; it is not an imported HR index. No old corpus or grants are migrated.
- `KnowledgeService.search` remains the HR keyword source and a retained shared compatibility reference. Existing HR readers/content/review/maintenance consumers stay. Legacy tool definitions/history modules still have references and are not deleted by name; no old runner/model selection is added to the new search path. Previous conflict authorization evidence is reused unchanged. Old HR semantic indexing is outside this approved stage; keyword search is retained, not silently disabled.
- The UI follows the approved implementation/layout checklist rather than reopening product decisions. Author checks and browser acceptance are complete; independent review remains the separately assigned next step.

```sh
pnpm exec vitest run tests/logic/native-knowledge.test.ts tests/logic/native-ai.test.ts tests/logic/v1-knowledge-service.test.ts tests/components/knowledge-source-search.test.tsx tests/components/knowledge-service.test.tsx tests/logic/page-permission-titles.test.ts
pnpm exec playwright test --config tests/playwright/native-knowledge.config.ts
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.server.json --noEmit
pnpm exec vitest run tests/logic/agents-md.test.ts
```

The browser config creates its own temporary cache and uses the actual Vite application config/source entry. It never loads deployment configuration or stores an authentication state file. The printed **Local** URL identifies this disposable test instance; it is separate from the Studio management instance.

## Details: measured cost windows

The attached `knowledge-costs.json` records complete named composition windows. Main SQL counts are executed statements, not affected rows. Index windows include bounded **test-only** observation of committed notifications/official queue completion; observation adds reads, not production polling. Vector counts instrument actual better-sqlite3 prepare/run/get/all/exec and native transaction invocations in the separate vectors file; they are not synthetic search results. Cache/worker ordering changes read counts, so these are evidence samples rather than fixed budgets. Setup, migrations, fixture insertion and earlier diagnostic runs are separate.

| Window                  | Main SELECT | INSERT | UPDATE | DELETE | Main transactions | Embedding HTTP | Usage INSERT | Vector statements | Vector transactions |
| ----------------------- | ----------: | -----: | -----: | -----: | ----------------: | -------------: | -----------: | ----------------: | ------------------: |
| search-native           |         322 |      1 |      0 |      0 |                 1 |              1 |            1 |                 1 |                   0 |
| no-model-fallback       |         309 |      0 |      0 |      0 |                 0 |              0 |            0 |                 0 |                   0 |
| failed-model-fallback   |         327 |      0 |      0 |      0 |                 0 |              3 |            0 |                 0 |                   0 |
| index-create            |          97 |      5 |      3 |      1 |                 3 |              1 |            1 |                 1 |                   1 |
| index-unchanged         |          81 |      2 |      2 |      1 |                 2 |              0 |            0 |                 1 |                   1 |
| index-reindex-unchanged |          55 |      0 |      0 |      0 |                 1 |              0 |            0 |                 0 |                   0 |
| index-update            |          99 |      3 |      6 |      1 |                 3 |              1 |            1 |                 1 |                   1 |
| index-acl               |          71 |      0 |      4 |      1 |                 2 |              0 |            0 |                 1 |                   1 |
| index-archive           |          56 |      0 |      1 |      1 |                 1 |              0 |            0 |                 1 |                   0 |
| index-dimension-change  |         115 |      5 |      9 |      2 |                 6 |              1 |            1 |                11 |                   3 |
| index-model-change      |         117 |      5 |      9 |      2 |                 6 |              1 |            1 |                11 |                   3 |
| file-upload-index       |         199 |      6 |      5 |      2 |                 5 |              1 |            1 |                 1 |                   1 |
| revoked-ticket          |          34 |      1 |      2 |      1 |                 1 |              0 |            0 |                 0 |                   0 |
| restricted-entry        |           0 |      0 |      0 |      0 |                 0 |              0 |            0 |                 0 |                   0 |
| revoked-entry           |          15 |      0 |      0 |      0 |                 0 |              0 |            0 |                 0 |                   0 |

- Each normal semantic aggregate search makes **one** vector query and successful usage insert, without a conversation or business draft write. The failed query sample made **three** local HTTP attempts under existing official SDK retry behavior and no usage insert; no application retry was added. No-model fallback makes no embedding/vector request.
- A title/version-only update performs native version/chunk and vector metadata writes without another embedding. Archive removes derived index entries, retaining the source document and history. Model and dimension rebuilds are separately measured official operations; all source-document counts remain unchanged.
- Restricted **service** rejection is zero SQL/model work. Each restricted **HTTP** request includes native key authentication/accounting: the sample is **8 SELECT / 2 UPDATE**, no document body/model/vector work. Key creation/revocation is fixture setup outside these windows.
- Revocation-during-query includes the fixture's permission revoke transaction/update/delete as well as the already-admitted query/usage write; those authorization writes are not new search behavior. Revoked ticket redemption has native staging/cleanup costs even though no proposal is created. Neither branch is described as free.
- Browser record: **24 local API calls**, including native sign-in and **23** page-observed calls; **3** controlled embedding HTTP calls total (one setup index batch, two searches). Sign-in is **21 SELECT / 1 session INSERT**. Each isolated administrator aggregate search sample is **229 SELECT / 1 usage INSERT / 1 transaction / 1 query embedding**. Native reader/tree/proposals/index requests also incur reads; initial locale synchronization is retained. A separate non-overlapping page meter records **1361 SELECT / 2 usage INSERT / 0 UPDATE / 0 DELETE / 2 transactions**, after login/fixture setup. Per-request SQL listeners can overlap during parallel page reads and are not added together. This disposable instance’s native ScheduleExecutor is shut down before fixture/browser work; native vector consumption stays active. An earlier, preserved meter crossed the hourly HR maintenance firing and observed **5788 SELECT / 252 INSERT / 236 UPDATE / 129 transactions** on synthetic seeded data; that is existing maintenance, not search cost or a performance comparison. Fixture model/document writes and startup are outside these final page windows.

No production model, external message, production channel activation, deployment or release was performed. The completion marker remains `.54`; application manifest/lock, historical sources, process/assistant/device closed defaults and preflight are preserved. Agents `.18` metadata-v1 upgrade review, remaining native Workflow integration and final applicable upgrade acceptance remain open.

## Direct reader search: current-result authorization

The reader's `GET /knowledge/search` now shares the facade's `currentKnowledgeHits` check. The official route factory receives a local service view whose `docs.search` delegates to real retrieval and then refreshes each hit through `docs.get` with the same reader. The shared service and index are not mutated. Only currently readable hits at the retrieved version survive; hidden 404 results are omitted, while other errors propagate. Official validation, response metadata and query/ranking options remain intact. The aggregate's existing check is extracted without changing its behavior.

- Before the fix (`362b596`), the independent real HTTP regression reproduced **16 passed / 1 failed**: revoking the ordinary user's native grant during the controlled embedding request still returned a title, document reference and protected excerpt. Adding the authorized cost control reproduced **17 passed / 1 failed**.
- After the fix, the native composition, legacy knowledge service and search UI selection passes **35/35** (21 native, 10 legacy, 4 UI). The added cases cover an authorized direct result, native-read revocation and HR-use revocation during embedding, and title-only/content version commits after real retrieval but before return. Stale hits disappear; the updated authorized versions remain searchable through the real index. Version cases use a test-only retrieval-boundary hook with real source writes, not simulated search results. Existing direct body/version/file/ticket, scoped-entry, cross-space, aggregate-revocation, increment/archive/model/dimension and legacy use/view checks remain in the selection.
- Client/server TypeScript and changed-file lint/format pass. No UI or HTTP protocol changed; existing English page evidence remains applicable. No new browser race or external-model test was run. Earlier unrelated fixture failures retain their recorded baseline status.

| Complete direct HTTP window          | SELECT before | SELECT after | INSERT | UPDATE / DELETE | Transactions | Query embedding | Vector query | Usage INSERT |
| ------------------------------------ | ------------: | -----------: | -----: | --------------: | -----------: | --------------: | -----------: | -----------: |
| Authorized, one returned candidate   |            79 |          119 |      1 |           0 / 0 |            1 |               1 |            1 |            1 |
| Native read revoked during embedding |            79 |          109 |      1 |           0 / 0 |            1 |               1 |            1 |            1 |

These are paired same-order samples: the added fresh-document check costs **40 SELECT** for the authorized candidate or **30 SELECT** before denying the revoked candidate, with no added model/vector request, write, transaction or lock. Work scales with retrieved hits, not with an added poll. The already-admitted query still incurs its original embedding and usage write even when the final result is empty. The aggregate sample remains **322 SELECT / 1 usage INSERT / 1 transaction / 1 embedding / 1 vector query**.

The revocation fixture is measured separately: **12 SELECT / 1 UPDATE / 1 DELETE / 1 transaction**, no model/vector work. Its query listener is explicitly excluded from the outer HTTP SQL window while that awaited fixture mutation executes; restoration and version-fixture writes are outside the paired samples. Counts vary with caching/worker order and are not a fixed production budget.

Rerun the complete composition file rather than filtering a late case because it includes the real index setup:

```sh
pnpm exec vitest run tests/logic/native-knowledge.test.ts tests/logic/v1-knowledge-service.test.ts tests/components/knowledge-source-search.test.tsx
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.server.json --noEmit
pnpm exec eslint server/providers/native-knowledge/routes.ts server/providers/native-knowledge/service.ts server/providers/native-knowledge/search-results.ts tests/logic/native-knowledge.test.ts --max-warnings 0
```

This increment changes no dependency, official index, storage, migration, queue or execution mechanism. Persistent knowledge Q&A stays deferred. External-provider validation is required before enabling that provider; PostgreSQL/pgvector and multi-instance Jobs need separate validation when those deployment forms are selected. The fixed Agents `.18` metadata-v1 evidence is retained and must be rechecked when upgrading that plugin. Isolated new-database restore and final-head strict installation/build/source-and-build startup and applicable business acceptance remain pending. Nonexistent old-environment migration/restore items remain not applicable. This fix awaits independent revalidation; the full PR remains a draft, not ready to merge or deploy.
