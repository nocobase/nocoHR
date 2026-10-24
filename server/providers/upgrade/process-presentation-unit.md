# Process presentation foundation

The fixed `.76` flow/lifecycle diagrams and workflow-management display parts are now available in NocoHR. This completes the presentation foundation only. No business process page, definition, parameter editor or persisted-history binding is claimed complete; the process runtime and upgrade preflight remain closed. The PR must stay in draft and must not be merged or deployed.

## Source ownership and consumers

The input is the previously approved `@nocobase/app-template-default@1.0.0-beta.76` release with Skills `.44`. Its public tarball SHA1 (`a65772d58490af3392b2ce80d120731d115a5f11`) and SHA512 match the existing release evidence; no tag was resolved again. [The F4 ownership subset](process-presentation-ownership.tsv) records each target/current hash. The original complete `.54 → .76` ledger remains the wider reconciliation inventory, not a completed-upgrade claim.

| Source                                                                                                 | Decision and behavior                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow-layout.ts`, `flow-diagram-css.d.ts`                                                              | Target layout, route validation and stylesheet declaration; actual ELK handles nodes, directed links, parallel paths, returns and self-transitions.                                                                                                                                                                   |
| `flow-diagram.tsx`                                                                                     | Target React Flow renderer, state/edge labels, current/visited markers, zoom, fit, overview and fullscreen. A scoped theme adaptation binds control colors to existing card/foreground/border tokens, preventing inherited white text on React Flow's light control background during a manually selected dark theme. |
| `lifecycle-diagram-model.ts`, `lifecycle-diagram.tsx`                                                  | Target description/history projection, classic/process presentations, return explanations and authorized parameter-binding selection. No runtime function is invoked.                                                                                                                                                 |
| `nocobase-workflow-management/{layout,definition-list,execution-list,execution-detail}.tsx` and README | Target presentational slots, controlled lists, sorting/pagination callbacks and sorted history-prefix selection. Effects show recorded status/errors/attempts and provide no retry action.                                                                                                                            |
| Locale adapters                                                                                        | Only the target `flowDiagram` groups are extracted into scoped system locale modules and imported by the retained English/Chinese application locales. Existing HR text is preserved.                                                                                                                                 |

Before this unit, none of these ten sources existed and no route imported them. The application still has no registered process-management page: `server/processes/index.ts` contains empty definition/handler registries. Existing Settings/DEV/HR navigation and permissions are untouched. The old AI `WorkflowRenderer` is a retained tool-result card, not a process diagram or an authoritative definition/history consumer; its protocol is not reinterpreted here.

The dependencies `@xyflow/react` and `elkjs` were already present in the fixed application graph. Existing Card, Table, Tabs, Button, Popover, Tooltip and standard DataTable parts satisfy the display imports. There is no manifest, lockfile, package registration or new alias change.

## Interfaces and remaining integration

- Lists accept display rows, status/empty content and callbacks. The application adapter still owns fetching, URL/filter state, authorization and page registration. Installation creates no empty production menu.
- `LifecycleDiagram.configuration.canConfigure` controls only declared field affordances. `onConfigure` returns the exact state/transition and authorized bound fields; the real editor must preserve complete groups, revision/CAS behavior, server checks and snapshot/live timing. The synthetic host only echoes the callback and never saves parameters.
- Historical selection sorts a copy by version/time/id, passes the selected prefix and destination to the renderer, and preserves recorded effects and parameters separately. It does not execute transitions, retry effects or fill missing historical facts with current values.
- Current scope (owner confirmation, 2026-10-23): there is no used old environment or existing production data. Old deployed definition/version inventories and execution records are not applicable; they are not passed tests. For new business process pages, first establish the repository definitions/handlers, supported parameters, current identity bindings and new-environment execution APIs. The application artifacts/history contract is not automatically a native `LifecycleDescription`.
- New-environment parameter read/save/denied-write behavior, actual business execution snapshots and isolated new-database backup/recovery remain unverified by this display unit. Old installed-history migration/checksum archives and old-environment restore are not applicable, per the owner; this does not establish migration/restore test success. No definition, schema, history record or business data is created by this source merge.

## Checks and browser evidence

This uses the frontend quick-change workflow: reconcile fixed presentation sources and their interfaces, without a new product page or business interaction. The component host exists only under `tests/fixtures/process-presentation/` and is served by the dedicated browser test; it is never registered by application routes.

- Actual ELK tests cover both directions, current/visited distinction, exact history edges, returns/self-links, empty graphs, duplicate nodes/edges, missing endpoints and invalid dimensions. Configuration tests retain only existing authorized bindings and reject unknown/denied targets.
- Actual React component tests cover English/Chinese empty/error states, history-prefix selection without mutating input, effect failure display, missing history/effects, detail-vs-tab chrome, parameter slots, pending refresh/pagination, list callbacks and native contextual selection without sensitive fields.
- Component/model selection: **19 passed**. Client TypeScript, affected lint/format and document links are checked separately. The broader locale-coverage selection has **3 passed / 2 failed**: both failures are the unchanged `navigation.breadcrumbMore` key. An isolated `7c2db61` source snapshot reproduces the same two failures. The new flow keys pass actual bilingual component rendering; no unrelated breadcrumb fix is included.
- Chromium uses a fresh native `createTestApp`, isolated SQLite/storage and native synthetic administrator sign-in. An unauthenticated host load is refused. Process execution and the compatibility assistant are disabled; Feishu is disconnected, Mail providers are disabled, business addresses and notification channels are empty, and no model service is configured. No real deployment configuration or credentials are read. Existing native jobs may still perform maintenance reads; no queue/lease/retry setting is changed.
- The browser executes actual React Flow + ELK, three states/four history edges, a return-history selection, the two-edge compact definition, authorized display callback, fullscreen/Escape and zoom/fit. Screenshots are English, on desktop, 375px and the dark theme. They explicitly identify synthetic component-host data. The dark control regression checks computed colors against the application's existing theme tokens.

Attached screenshot names: `process-execution-host-en.png`, `process-definition-host-en.png`, `process-host-mobile-en.png`, `process-host-dark-en.png`. These are running component-host views, not real HR workflow acceptance or a parameter editor. The host/test application are closed after capture; the temporary origin is recorded with the browser costs.

## Request and persistence cost

The components import no API client or business service. They compute layouts in the browser and delegate display callbacks. No request, database operation, model request, write, transaction, lock, claim or polling is added by rendering, history selection, binding selection, zoom or fullscreen.

In the isolated browser capture, native sign-in and host admission are counted separately in `browser-costs.json`; startup migrations/seeds are fixture provisioning and excluded from that request window. The first capture observed **21 SELECT / 1 session INSERT** for native sign-in, no UPDATE/DELETE/transaction. The two host-admission session checks were cache-served with no SQL. Display interactions added **0 HTTP / 0 SQL** in that capture. A preceding observation caught two existing Mail maintenance SELECTs (`mail_outbox` and `mail_account_removals`) during the window; these are retained application background work, not component requests, and cannot be called zero merely because the display adds none. The final capture independently observed the same sign-in counts and two existing Mail maintenance SELECTs during the display window, with no display HTTP or writes. Counts are not composed into a fixed budget.

No process/parameter/history/business writes, model calls or external messages are performed. Synthetic sign-in writes are not hidden by the implementation's zero incremental cost.

## Reproduce and retention

```sh
pnpm exec vitest run tests/logic/process-presentation.test.ts tests/components/process-presentation.test.tsx
pnpm exec vitest run tests/logic/app-locale-coverage.test.ts
pnpm exec playwright test --config tests/playwright/process-presentation.config.ts
pnpm exec tsc --noEmit
pnpm exec vitest run tests/logic/agents-md.test.ts
```

The browser config owns its temporary Vite cache and never shares a running development server's cache. `PROCESS_PRESENTATION_EVIDENCE` optionally selects the screenshot/cost directory; otherwise it uses the test output directory. No authentication state/cookie file is saved. No full installation/build, unrelated authentication/AI suite or production process run is repeated.

All 138 tracked migration/seed sources remain byte-identical to `7c2db61`. The application manifest/lock, route/grant IDs, native AI and device authorization, process/assistant defaults, upgrade preflight and completion `.54` are preserved. Fixed `.76/.44` is unchanged. Knowledge staged search is approved; persistent knowledge Q&A remains deferred. New-environment Workflow definitions/handlers, identity/parameter/history integration and isolated new-database recovery remain independent gates. No used old environment or existing production data exists, per the owner; old installed archives and old-environment recovery are not applicable. The known chat-service login-return fixture failures, notification assertion and permission-editor comment remain unchanged; no CI result is inferred from an empty check list.
