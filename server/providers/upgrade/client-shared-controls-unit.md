# Shared controls unit

This unit merges the fixed `.76` presentation and permission-editor differences into the retained NocoHR application. It keeps the independent application and Settings shells, route IDs and URLs, route authorization, permission-set API contract, grant IDs, batch selection and save behavior. It does not advance `defaultTemplateVersion` from `.54`.

## Ownership and implementation

| Area                      | Fixed template `.76`                                                                                                          | NocoHR decision                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header breadcrumbs        | Route metadata fallback, explicit `usePageBreadcrumbLevels`, compact responsive trail and folded middle levels                | Adapted in `client/components/breadcrumbs.tsx` and the target `Breadcrumb` primitive. Route-derived titles still use NocoHR's authorized route tree; denied routes are omitted. Both retained shells render the trail in their own header.                                                         |
| App and Settings shells   | Unified shell and routes                                                                                                      | Retained `client/layouts/app-layout.tsx` and the separate `client/layouts/settings-layout.tsx`. NocoHR branding, app navigation, Settings URL/menu/access, header actions, mobile employee tabs, chat and their route/authz declarations remain application-owned.                                 |
| Child pages               | Add the template stacking level                                                                                               | Added `z-10`, retaining the existing inert behavior and route/back semantics in `RouteChildPage`. Removed page-local breadcrumb rows from its 19 direct consumers so the shell owns the trail.                                                                                                     |
| Route dialogs and drawers | Dynamic viewport cap, fixed header/footer, independently scrolling body and dialog spacing                                    | Applied in `RouteOverlay` and the dialog/alert-dialog primitives. Existing focus restoration (including nested overlays), close guards, URL/query handling and parent navigation remain.                                                                                                           |
| Permission editor         | Responsive category/action layout, range explanations and hints, no-op grant updates and preservation of unknown scope values | Adapted in `PermissionEditor`, `permissions-model.ts` and `permission-filters.tsx`. NocoHR's group batch checkbox and category counts remain. The role form only receives localized presentation labels; permission identifiers, route IDs, authorization checks and save API calls are unchanged. |
| Navigation transform      | Target candidate uses a separate transform helper                                                                             | Not added: the target helper is absent from the application and the existing NocoHR route-navigation module owns route discovery and authorization filtering. No second navigation mechanism is introduced.                                                                                        |

Direct breadcrumb consumers moved to the shell are:

- `client/components/talent/data-import-page.tsx`
- `client/pages/settings/payroll/structure.tsx`
- `client/pages/talent/certifications/detail.tsx`
- `client/pages/talent/courses/editor.tsx`
- `client/pages/talent/employees/detail/index.tsx`
- `client/pages/talent/employees/import.tsx`
- `client/pages/talent/exams/detail.tsx`
- `client/pages/talent/knowledge/detail.tsx`
- `client/pages/talent/learning/course.tsx`
- `client/pages/talent/my-exams/attempt.tsx`
- `client/pages/talent/payroll/cycle/index.tsx`
- `client/pages/talent/performance/cycle-detail.tsx`
- `client/pages/talent/performance/review.tsx`
- `client/pages/talent/practicals/record.tsx`
- `client/pages/talent/practice/index.tsx`
- `client/pages/talent/succession/detail.tsx`
- `client/pages/talent/talent-reviews/detail.tsx`
- `client/pages/talent/training-evaluations/respond.tsx`
- `client/pages/talent/translations/detail.tsx`

The `usePageBreadcrumb` override contract is supported for pages that need record-specific trails; this repository currently has no page using that hook.

No authentication presentation, workflow diagram, Knowledge feature, route registration, permission grant, database schema, storage or server authorization code changed in this unit.

## Evidence

The screenshots are from the running isolated application at `http://127.0.0.1:13477/main/`, using a new SQLite/storage directory and the application's native synthetic administrator login. Its configuration disabled AI, process/workflow execution, Feishu long connections and outbound mail; the browser allowed only the local application host. Screenshots were made in English. The development annotation toolbar was hidden through test-only browser styling so the application UI stays legible; no application styles were changed. The preview service was stopped after capture.

- [`route-child-breadcrumb-en.png`](evidence/client-shared-controls/route-child-breadcrumb-en.png): `/talent/employees/import`, Employees → Import employees; clicking the parent breadcrumb returns to `/talent/employees`.
- [`route-overlay-en.png`](evidence/client-shared-controls/route-overlay-en.png): the registered `/talent/competencies/assessments-import` route dialog opened from the competency dictionary. Escape returns to its parent and focus returns to the opener.
- [`permission-editor-en.png`](evidence/client-shared-controls/permission-editor-en.png): `/settings/authorization/permission-sets/edit/:key`, an existing synthetic permission set with its stored View grant and “No additional record access” range displayed.

The browser flow created and updated synthetic permission sets in the disposable database, then reopened the edit route to confirm that the new grant remained saved and the removed grant stayed absent. The final evidence pass observed 48 local API calls: one permission-set `POST`, one `PATCH`, two existing locale-preference `PUT`s, one native sign-in `POST`, and the remaining reads for authentication, route data, settings and permissions. A prior capture retry also completed one create/update in the same disposable database, so two synthetic permission sets were created and updated across the browser attempts; no real user or business records were touched. Non-local browser origins were blocked. SQL was not instrumented. The shared-controls implementation itself adds no request, SQL, persistence write, transaction, lock, migration or poll; the observed create/update and locale writes are the existing application contracts exercised by the test.

## Verification

- `pnpm exec vitest run tests/components/app-layout-routes.test.tsx tests/logic/route-overlay.test.tsx tests/components/permission-editor.test.tsx tests/components/permission-filter-binding.test.tsx tests/components/permission-filter.test.tsx tests/components/user-permissions.test.tsx tests/components/role-list.test.tsx tests/logic/settings-permissions.test.ts tests/components/settings-continuity.test.tsx tests/logic/page-permission-titles.test.ts` — 10 files, 59 tests passed.
- `pnpm exec tsc --noEmit` — passed.
- ESLint over changed client/test TypeScript — no errors; three existing warnings remain in `client/pages/talent/learning/course.tsx` and `client/pages/talent/practice/index.tsx`. Running ESLint against the `HEAD` versions reports the same ref-name and array-index-key warnings.
- Prettier on the shared-control source, locales, tests and this record; `git diff --check` — passed.
- Real-browser checks covered breadcrumb routing, the live route dialog's open/close/focus restoration, permission value display, create/update persistence and reload. Authorization semantics and route IDs were retained; no real user/business data was used.

The test suite emits existing missing-source-map notices from installed authorization/authentication client packages; they do not fail the scoped tests. Full application install/build and full-upgrade runtime acceptance remain centralized follow-up gates.

## Upgrade boundary

The fixed target remains `.76` with Skills `.44`; the application marker is still `.54`. The application lock, 138 historical migration/seed sources, feature gates and preflight are unchanged. These UI checks do not validate an installed deployment, historical migration checksums, Knowledge boundary, Workflow definitions/history, old-database recovery or the final integrated build/startup. PR #2 remains draft and is not ready to merge or deploy.
