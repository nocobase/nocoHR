# Client type and pagination merge: `.74 → .76`

This unit merges the fixed `.76` target's explicit client Node type declaration and DataTable pagination behavior while preserving application configuration and presentation changes. The target template tarball SHA-1 is `a65772d58490af3392b2ce80d120731d115a5f11`; the compared `.74` source tarball SHA-1 is `8ec41da690c239f40c88e949082749807af64b83`. Skills `.44` is already synchronized byte-for-byte (105 files); it was not reinstalled.

| File                                          | Decision                                                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`                               | Sync `.76`'s `compilerOptions.types: ["node"]`. Retain the application's `@/*` path, `workflows/*/client` include, and registry exclusion.                                                         |
| `.agents/rules/build-and-deploy.md`           | Add the target client typechecking rule. Retain NocoHR deployment and build guidance.                                                                                                              |
| `client/components/data-table/data-table.tsx` | Sync `.76`'s `autoResetPageIndex: paginationState === undefined`: uncontrolled pagination resets after data changes; controlled hosts keep control of URL page resets and correction after writes. |
| `client/components/data-table/pagination.tsx` | Sync the target's wrapping, shrink and whitespace classes for narrow layouts. Retain the app's bounded `SelectContent` sizing and existing public props.                                           |
| `tests/components/data-table.test.tsx`        | Import the nested target implementation explicitly and cover refreshed data in controlled and uncontrolled modes. The previous import resolved the separate root legacy component.                 |

Verification on this change:

- Client TypeScript project: `pnpm exec tsc --noEmit -p tsconfig.json` passed.
- DataTable and Users Settings tests: `pnpm exec vitest run tests/components/data-table.test.tsx tests/components/settings.test.tsx` passed.
- Changed TypeScript/TSX lint and changed-file Prettier checks passed.
- A local running application at 375 px wide in English rendered the table controls without horizontal document overflow. The enabled next-page button was visible and clickable; the indicator changed from `Page 1 of 9` to `Page 2 of 9`. The attached screenshot contains the controls only. This uses a fresh local SQLite test database and public example-account configuration; no production service or external model was contacted.

The code change adds no HTTP call, database operation, write, lock, transaction, or poll. Browser acceptance used the normal page-load and pagination requests, but those requests and SQL statements were not instrumented for an exact count. The local run reported one pre-existing React script-render warning; the page loaded and the pagination interaction succeeded.

The application template marker remains `.54`; `pnpm-lock.yaml`, package registrations, disabled gates, preflight and all 138 historical migration/seed files are unchanged. This unit does not complete installed-data, Knowledge, Workflow, legacy-history, backup/recovery or full upgrade acceptance. PR #2 remains draft and is not ready to merge or deploy.
