# Authentication forms unit

This unit applies the fixed `.76` password-form presentation changes within NocoHR's existing guest authentication pages. The application marker stays at `.54`.

## Ownership and implementation

- Updated the auth-form UI imports to the target's `#components` package-local specifiers.
- Added the optional `below` slot to `AuthField`, rendered after the control and its field error with the target muted link styling.
- Moved the existing forgot-password link from the password label row to below the password input. Its existing `/forgot-password` destination is unchanged; keyboard order now proceeds from password visibility control to the link and then the submit button.
- Kept the remaining registration, reset and reset-request forms behaviorally unchanged. Their submission actions, field validation, error and success messages, password visibility control and localized labels remain as before.
- Kept the application-owned `/login`, `/register`, `/forgot-password` and `/reset-password` routes, NocoHR's branded page composition, native authentication actions, disabled self-registration behavior and login-return validation. No auth configuration, session handling, translation key, API, permission, database or secret changed.

The fixed `.76` target differences for the six `client/extensions/nocobase-auth-forms/` files are now recorded as reconciled in `template-file-review.md`. The two targeted auth test files are also linked to this evidence. Existing login-return behavior remains covered by its selected suite and the client integration record.

## Verification

- `pnpm exec vitest run tests/logic/client-auth.test.tsx tests/components/auth-i18n.test.tsx` — 2 files, 8 tests passed. The login test asserts the forgot-password link follows the password field in DOM order and retains the same URL; language switching and form wiring remain covered.
- `pnpm exec vitest run tests/logic/sign-in-return.test.tsx -t 'keeps an application path|rejects|reads the target|builds the sign-in path'` — 13 tests passed, 6 filtered. These are the existing URL safety and sign-in-return cases relevant to the unchanged routes.
- An unfiltered attempt across those three files had 21 passing tests and 6 failures in the `sign-in-return` application-shell fixture. The failures throw `Unexpected service token` when `ChatProvider` asks for `useRealtimeTopic`; this auth-form change does not touch that provider or test harness, and the fixture was left unchanged.
- `pnpm exec tsc --noEmit`, changed-file ESLint and Prettier passed. No full application build was run.
- In an isolated source copy with disposable SQLite/storage, the guest route was opened at `http://127.0.0.1:13000/main/login?redirect=%2Ftalent%2Fcertifications%3Ftab%3Dhistory`. The English desktop and 390 px mobile screenshots are `evidence/client-auth-forms/login-desktop-en.png` and `evidence/client-auth-forms/login-mobile-en.png`. Browser checks verified the field/link keyboard sequence, no horizontal overflow at 390 px, and navigation to `/main/forgot-password`. The request target in the URL was not submitted; no user sign-in or business form was performed.

The browser instrumentation captured one local API request; the application log showed four `GET /api/auth/get-session` calls over page render and navigation. SQL was not instrumented. No login, registration or reset write was submitted, and no external browser origin was attempted (non-local browser requests were blocked). The isolated application startup reported local mailboxes with no Mail accounts bound and a mock attendance pull of zero records; it did not contact an external provider. The process was stopped after capture. The React script-render console warning was observed; no page error occurred.

The implementation itself adds no HTTP request, SQL query, persistence write, transaction, lock, migration or poll.

## Upgrade boundary

The target remains `.76` with Skills `.44`; `defaultTemplateVersion` remains `1.0.0-beta.54`. The application lock, 138 historical migration/seed sources, closed feature gates and preflight remain unchanged. The PR has no CI check result and stays draft. Full integrated build/startup, the remaining ordinary template files, Knowledge product decision, Workflow definitions/history, historical database and recovery evidence remain separate gates; this unit does not establish overall upgrade acceptance or readiness to merge/deploy.
