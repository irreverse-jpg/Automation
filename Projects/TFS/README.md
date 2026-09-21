# TFS automation suite

QA automation for The Fuel Store (thefuelstore.co.uk), built to match the PBS/Withers/CareUK/MCC/RSC/NPL Playwright + k6 structure so it can live independently in the same multi-root workspace.

## How this project is different

Every other project in this workspace tests a public marketing site. TFS's portal is a **login-gated customer account area** (Kentico-based, "Fuel Card Account" management) on both environments - even `/` on QA redirects straight to `/login`, and there is no content to test until a session is authenticated. On Live, the public marketing site (thefuelstore.co.uk) sits at the domain root and the same portal lives under `/portal` (login at `/portal/login`).

Confirmed by logging in with the shared credentials on 2026-08-25/26 (same Email + Password work on both environments): after login the portal (`/portal/`) exposes this left-hand navigation:

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

The usual default-4 (`homepage`/`meganav`/`footer`/`search`) don't map cleanly onto an account dashboard, so specs for these sections are being planned/built one at a time:

- `01-tfs.login.spec.js` - the login form itself (field presence/fillability, native required-field validation, invalid-credentials error handling, successful login, logout). See its own "Coverage notes" header comment for the full list and any confirmed behaviour. Confirmed 2026-08-26: identical selectors, error copy, and behaviour on both QA and Live - the spec has no environment-specific branching.
- `02-tfs.dashboard.spec.js` - the post-login Dashboard (`/portal/`): header (account dropdown incl. all 10 known accounts, logout, logo), sidebar collapse/expand, the 6 summary cards (with a genuine hover state), a 5-account sweep confirming the summary cards and Monthly chart genuinely update per account, Make Payment (opens an external payment gateway in a new tab), and both Recharts bar charts (hover tooltips, Total (£)/Quantity (Ltrs) tab switching). See its own "Coverage notes" header comment for the full list, the two confirmed QA/Live differences, and the flakiness sources found and fixed while building it - worth reading before touching chart/popup/account interactions again. **Runs `test.describe.configure({ mode: 'serial' })`** because it includes 2 tests that switch the account, which is genuinely un-isolatable server-side session state (see "Known limitation" below) - use `npx playwright test --workers=1` for a fully reliable full-suite run locally.
- `03-tfs.accountdetails.spec.js` - Account Details (`/portal/account-details`), 22 tests: navigating there via the real sidebar link, header chrome (shared via `portal-helpers.js`), the personal-details card, the Filter Results panel (presence pass plus 6 tests on actual filtering behaviour - Document No. live substring match; Start/Due/End Date via a real react-datepicker calendar, since typing text visually updates the field but does NOT apply the filter; Quantity Min/Max; Total Min/Max via both typing and the number input's spinner arrows), the History table's Sort by control (open/close, then a dedicated test per sort field), Download (both the header's `.xlsx` export and each row's PDF/Excel Actions-column links, sampled across 5 rows - all real downloads, always cancelled, never saved to disk), and pagination (First/Previous/Next/Last plus page-number jumping - the numbered page list is desktop-only, confirmed hidden on tablet/mobile). The History table/filter mechanics (sort, pagination, date-picker, column reading, currency/date parsing) live in `history-table-helpers.js`, shared with `04-tfs.invoices.spec.js` below since it's the exact same widget. See this file's own "Coverage notes" header comment for full details, including several real per-field quirks found in this account's data: Type and Quantity (Ltrs) never vary (so sorting/filtering by them can't visibly reorder or narrow anything), and End Date alone doesn't bound results the way Start/Due Date do (asserted as "a broad, non-empty result set" rather than date-range correctness the feature doesn't currently deliver standalone). Confirmed 2026-09-02: identical on QA and Live, 66/66 clean with `--workers=1`.
- `04-tfs.invoices.spec.js` - Invoices (`/portal/invoices`), 19 tests: confirmed 2026-09-03 to be the SAME History table widget as Account Details - identical columns, sort options, pagination, per-row PDF/Excel download links, and even the same underlying invoice data. The only real differences: no personal-details card, and the Filter Results panel has only 4 fields (Document No., Due Date, Start Date, End Date - no Quantity/Total range). Built entirely on the shared `history-table-helpers.js` mechanics from `03-tfs.accountdetails.spec.js`, so it inherits the same react-datepicker/Type-Quantity-homogeneity/End-Date/live-data-volatility behaviour without re-deriving it. Confirmed 2026-09-03: identical on QA and Live, 57/57 clean with `--workers=1`.
- `05-tfs.sitelocator.spec.js` - Site Locator (`/portal/site-locator`), 8 tests: unlike every other portal page, this one is NOT TFS's own app at all - the whole page body is an iframe embedding a completely separate third-party site (`stationfinder.co.uk`, a Google Maps-based fuel station finder). Covers: location-required validation (a native `alert()` dialog), the Google Places autocomplete field, searching, narrowing by Range/Card Types/Facilities (Card Types update results live as you click them, Range and Facilities only take effect on the next Search click - confirmed 2026-09-04), real map gestures (drag-to-pan, plain-scroll-shows-a-hint vs Ctrl+scroll-actually-zooms), clicking a result to open its map info window and confirming it matches the Site List by name and address, and the Site List panel's expand/collapse. See its own "Coverage notes" header comment for the third-party cookie banner handling and two real gesture-timing gotchas found while building it (a drag needs a paused, staged gesture to register at all, and the map's fixed height means its center can be off-screen at the default viewport unless scrolled into view first). Confirmed 2026-09-04: identical on QA and Live (same third-party embed either way), 24/24 clean twice on QA and once on Live with `--workers=1`.
- `06-tfs.transactions.spec.js` - Transactions (`/portal/transactions`), 27 tests: another History table + Filter panel page, but with its own 12-column layout and 8 filter fields (Invoice Number, Card Number, Date After, Date Before, Min Volume, Max Volume, Reg Number, Driver Name) - no personal-details card and, unlike Account Details/Invoices, no per-row PDF/Excel download links (only the header's single "Download" button). The 4 text filters are typed with `pressSequentially(..., { delay })` rather than `fill()`, at Hector's explicit request, since they narrow the table on every keystroke. Found and documented a real markup defect in Min/Max Volume: the page renders two "range" blocks (labelled "Min Volume" and "Max Volume") that both contain the exact same pair of `id="filter-Quantity-min"`/`id="filter-Quantity-max"` inputs (duplicate, non-unique ids, same class of bug as the Site Locator's third-party embed) - confirmed the duplicates are true mirrors of one value, not independent fields, so the spec always targets `.first()` of each. Despite the confusing markup, the filtering itself was verified to work correctly in both directions (unlike Account Details' Quantity Min/Max, which is genuinely broken there because that account's Quantity is always 0). See its own "Coverage notes" header comment for full details. Confirmed 2026-09-04: identical on QA and Live, 78/78 clean twice on QA and once on Live with `--workers=1` (after fixing one real test-flakiness bug found while building it: reading the table immediately after a sort click can catch it mid-reload, same as `TABLE.readDocumentNumbers()` already guards against - fixed with the same "wait for a row to be visible first" pattern).
- `07-tfs.payments.spec.js` - Payments (`/portal/payments`), 15 tests: switches to the "AUCTUS MANAGEMENT GROUP LTD" account on every test (per Hector's instruction, since the default account's payment history is too thin to exercise pagination) via a new shared `selectAccount()` helper in `portal-helpers.js`. Own 4-column layout (Date, Type, Status, Total) and 3 filter fields (Status, Date, Type) - Status/Type genuinely return 0 results for any real value since both columns are blank for every row on this account, while the single Date field genuinely works as an "on or before" filter. Covers Make Payment opening a real external payment gateway pre-filled with a "The Fuel Store account number" field that genuinely differs per selected account (confirmed switching to "HILL HOUSE SCHOOL LIMITED" mid-test shows a different number) - no further testing happens inside the gateway itself. Found and fixed two real bugs while building this file: the shared `pickCalendarDate()` helper's month-navigation guard (24) wasn't enough to reach dates this far in the past (fixed by raising it, later revisited again for 08 below), and every test here leaves the shared server-side account session on a non-default account, which was contaminating whichever spec ran next - fixed with a file-level `afterAll` hook that restores the default account. Confirmed 2026-09-18: identical on QA and Live, 45/45 clean twice on QA and once on Live with `--workers=1`.
- `08-tfs.managecards.spec.js` - Manage Cards (`/portal/manage-cards`), 26 tests: own 9-column layout (Card Number, Card Type, Driver Name, Reg Number, Expires, Last Location, Last Used, Status, Cost Center) plus a 10th Actions column with per-row Stop Card/Request Pin Reminder buttons - both genuinely open their own confirmation modal with real copy and a real primary action, confirmed without ever completing either action. Card Number is a clickable link opening a details panel, confirmed to show the same card number that was clicked across a random sample of rows. Order Card opens a 2-step modal (choose a card type, then a driver-details form) - closed via X after confirming the step change, per Hector's instruction not to submit an order; found and documented a real defect there too, that "SHELL FLEET" and "SHELL FLEET HYBRID" share the identical underlying `<option value>` GUID. Both Expiry start/end date filters genuinely work (`on or after`/`on or before`) - worth noting an earlier ad hoc probe script had wrongly concluded Expiry start had no effect at all, which turned out to be that script's own timing bug, not a real defect (see this file's own "Coverage notes" for the full story - a good reminder that a quick manual check isn't a substitute for the same settle-then-read rigor as the real test). Also fixed a second real gap in the shared `pickCalendarDate()` helper: it could only ever navigate to a PAST month, but card Expiry dates on this account run into the future (2027-2030) - now compares actual month/year values and picks whichever direction (Previous/Next) is correct. Confirmed 2026-09-18: identical on QA and Live, 78/78 clean twice on QA and once on Live with `--workers=1`.
- `09-tfs.additionalservices.spec.js` - Additional Services (`/portal/additional-services`), 24 tests: a static content page, not a History table page - lists 4 service panels (FuelConnect, Clean Air Partnership (CAP), FraudGuard, AdBlue, confirmed identical order on QA and Live) each sharing the exact same "Enquire" form, prefilled per service via a REGARDING field. Covers FuelConnect's extra "Log In" link (opens the Live FuelConnect app in a new tab, regardless of which TFS environment it's clicked from), real native HTML5 required-field validation stepping through First Name -> Last Name -> Phone -> Email in order, and a real successful submission with the (non-required) Message field left blank - flagged as a minor documented UX gap, not chased further. **Every submission is a REAL enquiry sent to TFS's live enquiry-handling endpoint** (unlike this project's download tests, which are always cancelled - there's no equivalent for a form POST), so every field uses unique, obviously-fake, rotating test data via `submissionCounter.js` (built for exactly this purpose) rather than static values, so real support staff can identify these as automated test traffic at a glance. Confirmed 2026-09-21: the counter genuinely advances once per project/viewport rather than once per whole command (all 4 services within one viewport share a number; desktop/tablet/mobile in the same run get 3 consecutive numbers) - see this file's own "Coverage notes" for the full explanation. Confirmed identical on QA and Live, 24/24 clean twice on QA and once on Live with `--workers=1`.

### Known limitation: account-switching tests and full-suite parallelism

Confirmed 2026-09-02: TFS's login issues the exact same session cookie value no matter which browser context logs in with these credentials - there is only one canonical, per-user, server-side session, never a distinct one per sign-in. This means any test that switches the selected account (in `02-tfs.dashboard.spec.js`) is genuinely unable to be isolated from every other test/spec/project sharing these credentials, including ones running concurrently in another device project or file. `test.describe.configure({ mode: 'serial' })` limits the blast radius to within that one file/project, but a **fully-parallel local run of the whole suite can occasionally show an unrelated test reading the wrong account** for no obvious reason.

- **CI is not at risk** - `playwright.config.js` sets `workers: 1` there, so nothing ever runs concurrently.
- For a **fully reliable local run of the whole suite**, use `npm run test:stable` (`npx playwright test --workers=1`).
- If a local parallel run (`npm test`) ever fails with a test reading an unexpected account (e.g. "DAVETESTING2" where the default was expected), re-run before treating it as a real defect.

## Login / authentication

Both environments require a real login (Email + Password) before anything else is reachable. This is handled once per test run via Playwright's `globalSetup`:

- [global-setup.js](global-setup.js) launches a browser, logs in through the real UI (`#input-email` / `#input-password` / `button.login__button`), waits for the redirect to `/portal/`, and saves the session to `auth/storageState.json`.
- The login page lives at `/portal/login` - confirmed to work as a stable login route on **both** QA and Live (QA's domain root additionally redirects `/` to `/login`, which serves the same form, but `/portal/login` is used everywhere for consistency). See [login-helpers.js](login-helpers.js) for the shared path/selector constants.
- [playwright.config.js](playwright.config.js) points every project (`desktop-chromium`/`tablet-webkit`/`mobile-chromium`) at that same `storageState`, so specs start already logged in - no per-test login steps needed. The one exception is `01-tfs.login.spec.js`, which opts out via `test.use({ storageState: { cookies: [], origins: [] } })` since it tests the login form itself and needs to start unauthenticated.
- `auth/` is gitignored (session state, not a secret to check in, but also not something to keep long-term).

Credentials are never hardcoded - they're read from environment variables:

- `TFS_EMAIL` / `TFS_PASSWORD` - the same credentials work on both QA and Live - loaded from a local `.env` file (gitignored, see `.env.example` for the shape) via `dotenv`, or from CI secrets (`secrets.TFS_EMAIL` / `secrets.TFS_PASSWORD` in `.github/workflows/playwright.yml`) when running in GitHub Actions.

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

- `https://tfs-qa.hosted.positive.co.uk/` (QA - portal at the domain root, login at `/login`)

Live environment:

- `https://www.thefuelstore.co.uk/` (public marketing site at the domain root, portal under `/portal`, login at `/portal/login`)

Both are login-gated and use the same credentials - point `TFS_BASE_URL` at either domain root and `global-setup.js` resolves the correct login path itself. Note `auth/storageState.json` is environment-specific (it's a session cookie for whichever environment logged in last) - re-run the suite after switching `TFS_BASE_URL` so `globalSetup` logs in against the new environment rather than reusing a stale session.

For one-off terminal runs, `TFS_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:TFS_BASE_URL = 'https://tfs-qa.hosted.positive.co.uk'
npx playwright test

# or against Live
$env:TFS_BASE_URL = 'https://www.thefuelstore.co.uk'
npx playwright test
```

## Findings report (for sharing with the team)

Every test run automatically produces a plain-language findings spreadsheet, in addition to the usual Playwright HTML report:

- `findings-report.xlsx` - open in Excel (or Google Sheets/Numbers), share the file directly (e.g. email/Teams/Slack attachment)
- `findings-reports/` - a timestamped copy is kept here after every run, so past runs aren't overwritten

The workbook has three sheets: **Summary** (checks run/passed/findings count), **Findings** (one row per failing test, plain-English "why"), and **All Tests** (every check run, passed or failed). Powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a `test.afterEach` hook at the top of every spec file (add this when the first spec file is created - copy verbatim from any existing project). Both `findings-report.xlsx` and `findings-reports/` are gitignored.

## Notes

- `submissionCounter.js` / `submission-counter.txt` are ready for whichever future form-submission spec needs unique, rotating test data.
- No cookie-consent banner was seen on the login page on either environment as of 2026-08-26 - this will need a first look once dashboard/portal specs are underway (the banner may only appear on the public Live marketing pages, which aren't covered yet).
