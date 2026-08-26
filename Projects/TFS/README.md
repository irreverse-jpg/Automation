# TFS automation suite

QA automation for The Fuel Store (thefuelstore.co.uk), built to match the PBS/Withers/CareUK/MCC/RSC/NPL Playwright + k6 structure so it can live independently in the same multi-root workspace.

## How this project is different

Every other project in this workspace tests a public marketing site. TFS QA is a **login-gated customer account portal** (Kentico-based, "Fuel Card Account" management) - even `/` on QA redirects straight to `/login`, and there is no content to test until a session is authenticated.

Confirmed by logging in with the QA credentials on 2026-08-25: after login the portal (`/portal/`) exposes this left-hand navigation:

- Dashboard (spend/usage charts, balance, active/on-order card counts, "Make Payment")
- Account Details
- Invoices
- Site Locator
- Transactions
- Payments
- Manage Cards
- Additional Services
- FAQs
- Contact

Spec files for these sections have **not** been created yet - only the shared scaffolding (config, CI, auth, findings report, k6 skeleton) is in place so far. The usual default-4 (`homepage`/`meganav`/`footer`/`search`) don't map cleanly onto an account dashboard, so spec planning for this project will follow up as a separate pass once we agree on which sections/flows to cover and in what order.

## Login / authentication

QA requires a real login (Email + Password) before anything else is reachable. This is handled once per test run via Playwright's `globalSetup`:

- [global-setup.js](global-setup.js) launches a browser, logs in through the real UI (`#input-email` / `#input-password` / `button.login__button`), waits for the redirect to `/portal/`, and saves the session to `auth/storageState.json`.
- [playwright.config.js](playwright.config.js) points every project (`desktop-chromium`/`tablet-webkit`/`mobile-chromium`) at that same `storageState`, so specs start already logged in - no per-test login steps needed.
- `auth/` is gitignored (session state, not a secret to check in, but also not something to keep long-term).

Credentials are never hardcoded - they're read from environment variables:

- `TFS_QA_EMAIL` / `TFS_QA_PASSWORD` - loaded from a local `.env` file (gitignored, see `.env.example` for the shape) via `dotenv`, or from CI secrets (`secrets.TFS_QA_EMAIL` / `secrets.TFS_QA_PASSWORD` in `.github/workflows/playwright.yml`) when running in GitHub Actions.

If either variable is missing, `global-setup.js` throws immediately with a clear message rather than letting every test fail downstream with a confusing "still on the login page" error.

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run k6 smoke profile (once the k6 file exists): `npm run load:smoke -- --env BASE_URL=https://tfs-qa.hosted.positive.co.uk`

## Environment

The default environment is controlled from [playwright.config.js](playwright.config.js) via `DEFAULT_BASE_URL`.

Current default:

- `https://tfs-qa.hosted.positive.co.uk/` (QA - login-gated)

Live environment:

- `https://www.thefuelstore.co.uk/` (public marketing site - **not** login-gated the same way; the saved `storageState` from QA has no meaning there)

For one-off terminal runs, `TFS_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:TFS_BASE_URL = 'https://tfs-qa.hosted.positive.co.uk'
npx playwright test
```

## Findings report (for sharing with the team)

Every test run automatically produces a plain-language findings spreadsheet, in addition to the usual Playwright HTML report:

- `findings-report.xlsx` - open in Excel (or Google Sheets/Numbers), share the file directly (e.g. email/Teams/Slack attachment)
- `findings-reports/` - a timestamped copy is kept here after every run, so past runs aren't overwritten

The workbook has three sheets: **Summary** (checks run/passed/findings count), **Findings** (one row per failing test, plain-English "why"), and **All Tests** (every check run, passed or failed). Powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a `test.afterEach` hook at the top of every spec file (add this when the first spec file is created - copy verbatim from any existing project). Both `findings-report.xlsx` and `findings-reports/` are gitignored.

## Notes

- `submissionCounter.js` / `submission-counter.txt` are ready for whichever future form-submission spec needs unique, rotating test data.
- No cookie-consent banner was checked yet - QA's `/login` page is a bare login screen, so this will need a first look once dashboard/portal specs are underway.
