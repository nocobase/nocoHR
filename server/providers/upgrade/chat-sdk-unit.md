# Chat SDK contract unit

The existing chat service, transport and confirmation hooks consume the fixed AI SDK successfully in scoped fixtures. Cancellation now reaches resumed connections and releases the incoming SSE reader; failed continuation after a tool decision surfaces the SDK error and removes the empty reply. This is a client contract unit, not a completed runtime cutover. Keep both replacement entries disabled and the template completion marker at `.54`.

## Behavior and retained contracts

- Text, automatic backend results, manual approval/rejection and mixed tool groups use the existing request bodies, model selection and message/tool identifiers. No SDK automatic-send option or native Agents substitution is introduced.
- The real `Chat` from `@ai-sdk/react@4.0.131` consumes application SSE converted to `ai@7.0.128` UI chunks. Decisions use the existing React hook and `RuntimeAIService`; the server adapter and executor remain the source of tool results.
- SDK `resumeStream()` resolves even when transport or stream consumption fails. The manual decision path now checks `chat.status/error`, like explicit Continue, so a failed continuation reports its error and removes its placeholder. Continue resolves the cached Chat inside the action rather than mutating the hook argument.
- Both resume paths forward the SDK abort signal to the existing service API. Cancelling the UI stream clears its coalescing buffers and cancels the SSE reader; it adds no server request, retry or polling.
- Reopened decided history requires explicit Continue. The saved prefix stays intact, completed backend calls are not executed again, and a finished reply cannot be continued a second time. No grants, tool policy or request fields change.

## Verified scope

The focused suites cover text, automatic results, approval, rejection, mixed groups, controlled business errors, explicit reopen/continue, owner isolation and withdrawn permission at send/decision/resume. They also cover failure after a successful decision, cancellation while either resume connection opens, and cancellation during send/resume body consumption. Existing page tests connect the actual Provider and Continue button to Chat; existing adapter tests cover the stored result and authorization boundaries.

The new SDK suite uses real Chat, transport, runtime-selection service, decision hook, server adapter and tool executor. Its API boundary and transcript/tool storage are synthetic, with a fake model and no external provider. Permission checks enforce owner isolation and a synthetic revoked permission, not the complete authentication/HR policy composition. The reopened transcript is a synthetic persisted snapshot, not a deployed data migration. Reader cancellation does not prove rollback of a business action already executed on the server.

Scoped client and SDK-test types inherit the application client configuration through `tests/tsconfig.chat.json`, without framework shims. That project covers the five nominated provider entry points and their transitive contracts. Application tooling remains an independent temporary installation with its own generated lock; the application lock and package manifest are unchanged. The application-local Skills remain unsynchronized; this unit used the previously integrity-verified exact `.42` package reference.

```sh
pnpm exec tsc -p tests/tsconfig.chat.json --noEmit
pnpm exec vitest run tests/components/assistant-sdk-chat.test.tsx tests/components/assistant-continue-reply.test.tsx tests/logic/assistant-chat-adapter.test.ts
```

Changed TypeScript files also pass the application's ESLint configuration and Prettier. This is the quick frontend workflow: no new page, styling or interaction design. Full-page browser inspection and English screenshots remain unavailable because the retained legacy plugin graph cannot install/start; no replacement entry was enabled to obtain them.

## Cost and remaining gates

Added requests, SQL, writes, transactions, locks, runner claims and polls: zero. Keep the once-per-service runtime-selection GET, existing history/state GETs and one explicit resume POST. Stream cancellation adds one in-memory abort controller/listener per active converted stream; buffers and reader are released on cancellation. Existing server persistence, authorization and business SQL costs are unchanged by this unit and were not measured here.

The old AI/Workflow registrations, all 138 migration/seed sources, historical data, closed gates, preflight verification blocks, manifest and application lock remain intact. This unit neither removes Hub/legacy plugins nor resolves the known package-version gap. Model/provider and attachment/knowledge/skills/MCP capabilities, deployed configuration/credential mappings, original migration archives, Workflow definitions and full Client 4/Server 3 composition remain separate cutover gates. Full application installation, build, strict source/compiled startup, real login/HR permissions and browser acceptance are still required before merging or deploying the upgrade.
