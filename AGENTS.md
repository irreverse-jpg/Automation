# AGENTS.md: instructions for AI coding agents

This file tells an AI coding agent (OpenAI Codex or similar) how to maintain and extend this repository without breaking how it is built. For the full technical explanation, read [FRAMEWORK_OVERVIEW.md](FRAMEWORK_OVERVIEW.md). For the human handover and project status, read [HANDOVER.md](HANDOVER.md).

> **How to read this file.** Everything in the **Rules** sections is an established convention. It was verified on 2026-10-27 against the code, configs, and the docs in this repo (`HANDOVER.md`, `Shared/README.md`, `Shared/docs/new-project-checklist.md`, project `README.md` files, and spec header comments). Anything marked **Recommendation** is advice, not current practice. Don't present it as existing convention in code or docs you write.

---

## 1. What this repository is

- Black-box, end-to-end QA automation for **8 client websites**. Each client has one **self-contained project** under `Projects/`: `PBS`, `Withers`, `CareUK`, `MCC`, `RSC`, `NPL`, `TFS`, `Turn2US`.
- The tests run against **deployed URLs** (QA, UAT, Staging, Live). They need network access to those sites. They are not unit tests, and there is no application source code in this repo.
- Each project contains:
  - Playwright specs (CommonJS JavaScript, no TypeScript)
  - an opt-in two-environment **envcompare** spec (all projects except Turn2US)
  - a **nonfunctional** spec (SEO, security headers, axe accessibility)
  - one **k6** load test (ES modules)
  - a custom **findings reporter** that writes a plain-language Excel report
- `Shared/` holds documentation only, no code. Projects do **not** import from each other or from `Shared/`.

## 2. Before you change anything

1. Identify the **one project** the task concerns, and work inside `Projects/<Client>/`.
2. Read that project's `README.md`.
3. Read the **header comment of the spec file** you are about to touch. These are the "Coverage notes" blocks below the imports, using labels such as `KNOWN ISSUE`, `CONFIRMED DEFECT`, `ENVIRONMENT DRIFT`, `LIVE SUBMISSION GATING`. They are the most detailed and up-to-date record of confirmed site defects, environment differences and past decisions for that page.
4. Look at a sibling spec **in the same project** for the helper and cookie-banner code to reuse.
5. If you are adding a new client project, follow [Shared/docs/new-project-checklist.md](Shared/docs/new-project-checklist.md) step by step.

## 3. Hard rules (never violate)

1. **Real defects stay as failing tests.**
   - Never weaken an assertion, add `test.skip`, or remove a link or page from a list to make a run green when the failure is a real site defect.
   - Never "fix" a spec to match a broken environment. For example, NPL's UAT meganav tests are written against Live's correct destinations on purpose.
   - Never skip or exclude a link that is broken on every environment just because there is no working reference to compare against. It must assert and fail.
2. **Do not run two environments of the same project at the same time.** They share `test-results/`, `findings-report.xlsx` and `findings-reports/`, and they silently corrupt each other. A concurrent run once produced a false "0 findings" report.
3. **Never submit real forms on Live.**
   - Existing gates include `isQaEnvironment(baseURL)` in RSC specs and `isLiveEnvironment(baseURL)` in [Projects/TFS/login-helpers.js](Projects/TFS/login-helpers.js).
   - Forms protected by reCAPTCHA skip the successful-submission test when headless (`testInfo.project.use?.headless !== false`). Keep these gates in any new form test.
4. **Never hardcode credentials or secrets.**
   - TFS reads `TFS_EMAIL` and `TFS_PASSWORD` from a gitignored `.env` (template: [Projects/TFS/.env.example](Projects/TFS/.env.example)) or from CI secrets.
   - Never print, log or commit their values.
5. **Do not delete `findings-reports/`** in any project. It is gitignored, but it is the only record of past runs. Check before deleting any file or folder, including gitignored ones.
6. **Don't touch generated output, and don't commit it**: `node_modules/`, `playwright-report/`, `test-results/`, `findings-report.xlsx`, `findings-reports/`, `k6-summary.json`, `auth/`, `.env`.
7. **Don't pass `--reporter=<x>` on its own.** It replaces the configured reporters, so the findings report is silently not written and the run still exits 0. If you need list output, pass all of them: `--reporter=list,html,./reporters/findings-reporter.js`.
8. **`npx playwright test --list` runs the findings reporter.** It overwrites `findings-report.xlsx` with an empty report and archives an empty copy. Avoid it when a real report needs to be kept, or back the report up first.
9. **Verify before reporting a defect.** Re-probe the exact element fresh in a browser before calling a failure a site defect. Values copied from an earlier, unrelated probe have been wrong before.

## 4. Project layout rules

- **Flat layout.** Specs live at the project root (`testDir: './'`). There are no `tests/`, `pages/` or `fixtures/` folders, no page-object classes, and no `test.extend` fixtures. Don't introduce them.
- **One spec file per page or site section**, including its sub-panels (filters, accordions, modals). Don't split one page across files.
- **File naming:** `NN-<client>.<area>.spec.js`, two-digit number, lowercase. The envcompare and nonfunctional specs and the `NN-<client>.load.k6.js` file come after the content specs.
  - Known exception: `Projects/RSC/05-rsc-membership.spec.js` uses a hyphen. Don't rename it.
  - Turn2US deliberately leaves numbers 06–14 free for future "Get support"-style specs.
- Every new project starts with these 4 specs: `homepage`, `meganav`, `footer`, `search`. It also gets `nonfunctional` and `load.k6`. CareUK is the recorded exception, with no generic search.
- **Shared helper modules exist only where real reuse appeared, within one project:**
  - `Projects/RSC/linkNavigationHelpers.js`
  - `Projects/TFS/login-helpers.js`
  - `Projects/TFS/portal-helpers.js`
  - `Projects/TFS/history-table-helpers.js`
  - `Projects/TFS/global-setup.js`
  - Otherwise, small helpers are **deliberately duplicated as local functions in each spec**. Examples: `acceptCookiesIfPresent`, `dismissCookieOverlayIfPresent`, `clickWithCookieGuard`, `openMenuIfPresent`, `normalizeWhitespace`.
  - Follow the local-function style. Don't extract cross-project shared code unless explicitly asked.

### When you add, remove or renumber a spec, update all of these

1. `package.json` scripts that name the file (`test:nonfunctional`, `test:envcompare`, `load:*`).
2. The project `README.md` file list.
3. `FRIENDLY_FILE_NAMES` in `reporters/findings-reporter.js`. If you skip this, the report shows the raw file name.
4. The k6 file's `QUICK GUIDE` comment, if the k6 file name changes.
5. For a **new project**, register it in [Projects/automation-tests.code-workspace](Projects/automation-tests.code-workspace). If you don't, the project won't show in VS Code's Explorer or Test Explorer.

## 5. How to write a spec (match this anatomy)

Every spec file follows this order:

```js
const { test, expect } = require('@playwright/test');

// Captures the page's web address at the moment a test fails, so the
// findings report can tell teammates exactly where an issue was seen.
test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('failure-context', {
            body: JSON.stringify({
                url: page.url(),
                pageTitle: await page.title().catch(() => ''),
                environment: testInfo.project.use.baseURL || '',
                viewport: testInfo.project.name,
            }),
            contentType: 'application/json',
        }).catch(() => {});
    }
});

// ============================================================================
// Coverage notes - <page/section> ("<path>")
// ============================================================================
// Scope, confirmed facts from direct probing (with dates), known defects,
// environment differences, and why any unusual choices were made.
// ============================================================================

const SOME_CONSTANTS = [ /* confirmed real paths/labels, not guesses */ ];

async function localHelper(page) { /* ... */ }

test('<Area> - <What is checked>', async ({ page }) => {
    await test.step('Open <page>', async () => { /* ... */ });
    await test.step('Verify <thing>', async () => {
        await expect(locator, '<plain-English reason this should be true>').toBeVisible();
    });
});
```

Rules behind the template:

- **The `afterEach` failure-context hook is mandatory**, copied verbatim into each file. All 106 current spec files have it. The findings reporter reads it to fill in the "Where (page address)" column. Envcompare specs also add `compareEnvironment`.
- **Every `expect()` takes a plain-English message as its second argument.** The reporter shows that message as the finding's "Why it's an issue". Write it for a non-technical reader.
- **Test titles use `<Area> - <What is checked>`.** Examples: `Homepage - Skip Links`, `Non-Functional - Core meta tags are present`, `Accessibility - Images have alt text or are explicitly decorative`. 684 of 756 top-level titles follow this pattern.
- **Newer convention**, from `Projects/Turn2US/05-turn2us.getsupport.spec.js`:
  - one `test.describe('<Section> - <Destination>')` per destination
  - each destination's standard test is named `Initial Page Load Tests`
  - deeper journeys are named `<Thing> Traversal`
  - Use this naming for future specs.
- **Use `test.step()`** to break tests into readable steps. It is used in almost every spec.
- **Navigation pattern:**
  1. `await page.goto('/relative/path', { waitUntil: 'domcontentloaded' })`, with paths relative to `baseURL`
  2. `await page.waitForLoadState('load').catch(() => {})`
  3. accept or dismiss the cookie banner
  4. assert
- **Wait for `networkidle`** (plus a short wait, if needed) before reading mega-menus or measuring element positions. `domcontentloaded` alone gave wrong-direction diffs on Withers.
- **Locators:** prefer `getByRole` and accessible names, then stable ids or classes. Use `.first()` where the site renders duplicates. Use `expect.poll()` for async state changes. Hardcoded values (titles, hrefs, labels) must come from **real probing of the site**, not guesses. Record the date in the header comment.
- **Timeouts:** keep the config defaults (`actionTimeout` 15s, `navigationTimeout` 30s). Use `test.setTimeout()` per test only when a page or journey is known to be slow.
- **Device-independent checks** (HTTP headers, robots.txt, sitemap, meta tags, analytics, favicon) run once, gated with `test.skip(testInfo.project.name !== 'desktop-chromium', '<reason>')`.
- **Acceptable `test.skip` uses**, always with a reason string:
  - device-independent gating
  - a page or menu item that doesn't exist on this environment yet (environment drift; documented in the header)
  - reCAPTCHA in headless mode
  - Live-submission gating
  - the envcompare opt-in
- **Unacceptable `test.skip` use:** hiding a real defect.

### Cookie-consent banners

- Most projects use **OneTrust** (`#onetrust-accept-btn-handler`).
- **Turn2US uses Cookiebot** (`#CybotCookiebotDialog`, accept button `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`).
- PBS's helpers handle both.
- TFS has no consent banner in the portal, but its Site Locator iframe has a third-party one. See that spec's header.
- The OneTrust Accept button appears before its click handler is attached, so a single click the instant it's visible can do nothing. The project helpers retry with `expect.poll` (see `Projects/NPL/01-npl.homepage.spec.js`). Reuse the existing helper from a sibling spec rather than writing a new one.
- `clickWithCookieGuard(page, locator)` retries a click with `force: true` when an overlay intercepts it.

### Forms and test data

- Use `submissionCounter.js` (`getCurrentSubmissionNumber`, `incrementSubmissionNumber`) and `submission-counter.txt` to generate unique, obviously fake test data on each run.
- Real submissions happen only on QA-type environments. Live is checked only up to "form is valid and submittable".

### TFS (login-gated portal), special rules

- [Projects/TFS/global-setup.js](Projects/TFS/global-setup.js) logs in once and saves `auth/storageState.json`, which every project reuses. `01-tfs.login.spec.js` and part of `13-tfs.nonfunctional.spec.js` opt out with `test.use({ storageState: { cookies: [], origins: [] } })`.
- The selected account is stored **server-side, per user**. A fresh login with the same credentials doesn't isolate tests. Any test that switches account must restore the default account afterwards (file-level `afterAll`), and the file should use `test.describe.configure({ mode: 'serial' })` where needed.
- For a reliable full local run, use `npm run test:stable` (`--workers=1`).
- Downloads are always cancelled, never saved. Orders, Stop Card and similar actions are opened and then closed, never completed.

## 6. Envcompare, nonfunctional and k6 conventions

- **Envcompare** (`NN-<client>.envcompare.spec.js`):
  - The whole `test.describe` is skipped unless `<CLIENT>_COMPARE_BASE_URL` is set alongside `<CLIENT>_BASE_URL`.
  - It writes one test per page for title parity, so each broken page gets its own row in the findings report.
  - The analytics-container check is a hard assertion.
  - Page lists (`PAGES_TO_COMPARE`) are curated, fixed lists, not crawls.
- **Nonfunctional:**
  - Uses `@axe-core/playwright` with `.withTags(['wcag2a', 'wcag2aa'])`, failing on **`critical`** violations only.
  - TFS deliberately widens this to `['critical', 'serious']`, which is documented in its header. Don't change either without being asked.
- **k6** (`NN-<client>.load.k6.js`):
  - Uses ESM `import`, never `require`. Playwright specs use CommonJS `require`. Don't mix module styles.
  - Has 5 scenarios via `--env SCENARIO=smoke|load|spike|soak|all` (default `all`).
  - Thresholds are identical everywhere: `http_req_failed rate<0.02`, `http_req_duration p(95)<1500`, `http_req_waiting p(95)<1000`, `errors rate<0.02`.
  - The custom `handleSummary()` prints a final verdict and writes `k6-summary.json`.
  - Keep the `QUICK GUIDE` comment block and keep its page list in sync with `browseCorePages()`.
  - Base URL resolution: `BASE_URL || <CLIENT>_BASE_URL || K6_BASE_URL`. **PBS and TFS accept `BASE_URL` only.**
  - The `npm run load:*` scripts don't set a URL. Pass `-- --env BASE_URL=...` or set the env var.
  - **Never run load, spike or soak against Live.** This is stated as a hard rule in `Shared/todo.md`.

## 7. Running things

Run from the project folder (for example `Projects/PBS`):

| Purpose | Command |
|---|---|
| Install | `npm install`, then `npx playwright install` |
| Full suite (headless, 3 device projects) | `npm test` |
| Full suite with fewer workers (recommended locally for large suites) | `npx playwright test --workers=2` |
| One file | `npx playwright test 08-pbs.savings.spec.js` |
| One device project | `npx playwright test --project=desktop-chromium` |
| One test by title | `npx playwright test -g "Homepage - Skip Links"` |
| Headed / UI mode | `npm run test:headed` / `npm run test:ui` |
| Other environment (PowerShell) | `$env:PBS_BASE_URL = 'https://...'; npm test` |
| Env compare | set `<CLIENT>_BASE_URL` and `<CLIENT>_COMPARE_BASE_URL`, then `npm run test:envcompare` |
| k6 smoke | `npm run load:smoke -- --env BASE_URL=https://...` |
| TFS reliable run | `npm run test:stable` |

- The host environment is Windows with PowerShell, under a OneDrive path that contains spaces. Quote paths.
- If many tests time out at once, check for leftover `chrome.exe` or `node.exe` processes from earlier runs before blaming the site. Too many parallel workers also causes fake timeouts.
- After a run, read `findings-report.xlsx` (plain language), then `playwright-report/` (`npx playwright show-report`) and the traces in `test-results/`.

## 8. Ad-hoc probing

- To confirm real selectors, titles or hrefs before writing assertions, a throwaway `node -e` script using `require('playwright')` or a temporary `_probe*.spec.js` has been the working practice.
- A temporary `_probe*.spec.js` at a project root **will be picked up by `npm test`**, because `testDir` is `./`. Delete it before finishing, and never commit it.
- Run a probe with an explicit project and the full reporter list (see Hard rule 7). Or run it in a way that won't overwrite a findings report you need to keep.

## 9. Documentation upkeep (part of every change)

- Update the spec's **Coverage notes** header with what changed, what was confirmed, and the date.
- Update the project `README.md` file list and notes when coverage changes.
- Update `HANDOVER.md` "Open work" or "Project status" when a project's status changes.
- Client-facing "QA Test Coverage Overview" `.docx` files belong in `Projects/<Client>/QA Test Coverage/`, never the project root.
- Observed commit style: `update DD.MM.YYYY`, on `main`.

## 10. Known inconsistencies: don't "fix" these silently

These were verified on 2026-10-27. Leave them as they are unless the task is to fix them, and mention them if they're relevant to your task:

1. **Hardcoded fallback credentials in `Projects/TFS/01-tfs.login.spec.js`** (the `VALID_EMAIL` and `VALID_PASSWORD` constants, around lines 55–56). This contradicts the TFS README ("Credentials are never hardcoded"). Don't copy or spread these values. Flag them if you work in that file.
2. **CI has never run.** Each `Projects/<Client>/.github/workflows/playwright.yml` sits inside a subfolder, and GitHub only runs workflows from the repo root. The TeamCity/Octopus plan in `Shared/todo.md` has not been started.
3. **Playwright versions differ.**
   - Seven projects declare `@playwright/test ^1.52.0`. Turn2US pins `1.61.1` exactly, with an `overrides` entry for `playwright-core`.
   - Locally installed versions currently range from 1.58.2 to 1.62.1.
4. **The `tablet-webkit` project name is misleading in 6 of 8 configs.** Withers, CareUK, MCC, RSC, NPL and TFS override `browserName: 'chromium'`. Only PBS and Turn2US actually run WebKit for tablet.
5. **Config shape varies slightly.** NPL and Withers set `baseURL` inline with no `DEFAULT_BASE_URL` constant. NPL omits `storageState: undefined`.
6. **The findings reporter is copied into all 8 projects.** Apart from comments, the copies differ only in `FRIENDLY_FILE_NAMES`, the `workbook.creator` and title strings, and the TFS header colour (`FF049EE0` instead of `FF041E42`). If you change reporter logic, apply it to all 8 copies.
7. **Stale docs:**
   - `Projects/PBS/.github/copilot-instructions.md` gives old file numbers (`09-pbs.nonfunctional`, `10-pbs.load`; they are now `14` and `15`) and says the base URL is switched manually. `PBS_BASE_URL` now exists.
   - Project READMEs describe a two-sheet findings workbook. The reporter now writes three sheets (Summary, Findings, All Tests).
8. **Generated files tracked by mistake:** `Projects/k6-summary.json` and `Projects/NPL/k6-run-output.log` are committed.
9. `Projects/NPL` has `submissionCounter.js` but no `submission-counter.txt`. The counter defaults to 1.

## 11. Recommendations (not established practice)

These are suggestions for a future maintainer. Only act on them if asked.

- **Recommendation:** remove the hardcoded TFS fallback credentials (rely on `.env` and CI secrets only), and rotate that account's password, because it is in git history.
- **Recommendation:** for new projects, pin `@playwright/test` exactly and add `"overrides": { "playwright-core": "<same version>" }`, as Turn2US does. Then run `npx playwright test` (not just `--list`) on all 3 device projects to confirm the browser builds exist.
- **Recommendation:** to make CI real, move a workflow to the repo-root `.github/workflows/` with `working-directory` per project, or follow the TeamCity → Octopus plan in `Shared/todo.md`.
- **Recommendation:** a Codex sandbox may block network access by default. These tests can't pass without access to the target sites.
- **Recommendation:** treat Claude-Code-specific files as tool-local and not part of the framework: `.claude/` folders and `Projects/PBS/.claude/settings.local.json`.
