# Framework Overview

A technical reference for the QA automation framework in this repository. It is written so that an engineer or AI coding assistant with no prior context can understand how the framework is built, how it runs, and why it looks the way it does.

- Day-to-day rules for coding agents: [AGENTS.md](AGENTS.md)
- Human handover and project status: [HANDOVER.md](HANDOVER.md)
- Onboarding: [Shared/README.md](Shared/README.md)
- New-project checklist: [Shared/docs/new-project-checklist.md](Shared/docs/new-project-checklist.md)
- CI/CD plan (not started): [Shared/todo.md](Shared/todo.md)

## 0. Sources and verification key

This document was compiled on **2026-10-27** by inspecting the repository directly: configs, `package.json` files, all 8 reporters, spec structure and helper modules, k6 files, and existing documentation.

| Label | Meaning |
|---|---|
| *(no label)* | **Verified fact.** Checked against the code or config in this repo on 2026-10-27, or stated in the repo's own documentation (`HANDOVER.md`, `Shared/*`, project READMEs, spec header comments). |
| **Documented:** | Stated in the repo's docs but not independently re-tested on 2026-10-27. Typical examples are site defects and runtime behaviour, which can only be confirmed by running against live sites. |
| **Working note:** | Comes from the original maintainer's Claude Code memory notes, which live outside this repo and won't carry over to another tool. Included because it is generic, technical, and consistent with the code. |
| **Recommendation:** | A suggestion, not current practice. |

No passwords, tokens or account details are reproduced here.

---

## 1. Summary

| Aspect | Detail |
|---|---|
| Purpose | Black-box functional, accessibility, SEO/security and load testing of deployed client websites |
| Tools | Playwright Test (JavaScript, CommonJS), `@axe-core/playwright`, `exceljs` (custom reporter), k6 (load), `dotenv` (TFS only) |
| Structure | 8 independent client projects under `Projects/`, no shared runtime code |
| Size | 106 Playwright spec files plus 8 k6 scripts, about 65,000 lines in total |
| Targets | QA, UAT, Staging and Live URLs of each client site; no app source code in the repo |
| Devices | Every spec runs in 3 Playwright projects: `desktop-chromium`, `tablet-webkit`, `mobile-chromium` |
| Output | Playwright HTML report, traces, and a plain-language **findings spreadsheet** for non-technical readers |
| Host environment | Windows and PowerShell, VS Code with the Playwright Test extension. **Documented:** Node v24 and k6 v1.7.1 were the versions on the build machine. |

---

## 2. Repository layout

```
Automation/                         <- git repo root
├── AGENTS.md                       <- agent instructions
├── FRAMEWORK_OVERVIEW.md           <- this file
├── HANDOVER.md                     <- status of every project, open work, gotchas
├── README.md
├── Automation.code-workspace       <- simple workspace (Projects + Shared roots)
├── .vscode/                        <- root launch/settings (not framework-critical)
├── Shared/                         <- documentation only
│   ├── README.md
│   ├── todo.md                     <- TeamCity → Octopus CI plan (not started)
│   └── docs/new-project-checklist.md
└── Projects/
    ├── automation-tests.code-workspace   <- THE multi-root workspace used day-to-day
    ├── k6-summary.json                   <- stray generated file (tracked by mistake)
    └── <Client>/                         <- PBS, Withers, CareUK, MCC, RSC, NPL, TFS, Turn2US
        ├── NN-<client>.<area>.spec.js    <- Playwright specs (flat, at project root)
        ├── NN-<client>.envcompare.spec.js
        ├── NN-<client>.nonfunctional.spec.js
        ├── NN-<client>.load.k6.js
        ├── playwright.config.js
        ├── package.json / package-lock.json
        ├── reporters/findings-reporter.js
        ├── submissionCounter.js (+ submission-counter.txt)
        ├── README.md
        ├── .gitignore
        ├── .github/workflows/playwright.yml   <- never executed (see §11)
        ├── .vscode/settings.json              <- Test Explorer settings (most projects)
        ├── QA Test Coverage/                  <- client-facing .docx
        ├── docs/                              <- Turn2US only
        └── (generated, gitignored) node_modules/ playwright-report/ test-results/
            findings-report.xlsx  findings-reports/  k6-summary.json  auth/ (TFS)
```

Project-specific extra files:

| Project | Extra files |
|---|---|
| RSC | `linkNavigationHelpers.js` |
| TFS | `global-setup.js`, `login-helpers.js`, `portal-helpers.js`, `history-table-helpers.js`, `.env.example` |
| Turn2US | `docs/benefits-calculator-journey.md` |
| Withers | `Withers - Live vs XbyK Environment Comparison Report.docx` |
| PBS | `.github/copilot-instructions.md` (partly stale, see §14) |

---

## 3. The client projects

| Project | Site | Environments (default **bold**) | Base URL env var | Spec files | Cookie banner handled | Notes |
|---|---|---|---|---|---|---|
| PBS | Principality Building Society | QA, **QA2**, UAT2, Live | `PBS_BASE_URL` | 14 | OneTrust and Cookiebot selectors | Mortgage and savings listing tools, reCAPTCHA form |
| Withers | Withers Worldwide | **UAT**, XbyK, Live | `WITHERS_BASE_URL` | 14 | OneTrust | Base URL includes `/en-gb` |
| CareUK | Care UK | **UAT2**, XbyK, Live | `CAREUK_BASE_URL` | 16 | OneTrust | No generic search spec |
| MCC | Lord's / MCC | **UAT2**, Live | `MCC_BASE_URL` | 15 | OneTrust | Real defects kept as failing assertions |
| RSC | Royal Society of Chemistry | **QA**, Live | `RSC_BASE_URL` | 16 | OneTrust | Shared `linkNavigationHelpers.js` |
| NPL | National Physical Laboratory | **UAT**, Live | `NPL_BASE_URL` | 12 | OneTrust (timing-sensitive) | UAT meganav tests intentionally fail |
| TFS | The Fuel Store (login-gated customer portal) | **QA**, Live | `TFS_BASE_URL` | 13 | none in portal | `globalSetup` login, `storageState` |
| Turn2US | Turn2us | **Staging**, UAT, Live | `TURN2US_BASE_URL` | 6 | Cookiebot | **In progress**, no envcompare spec |

The exact URLs for each environment are in the comment above `baseURL` in each `Projects/<Client>/playwright.config.js`. For per-project status and documented findings, see HANDOVER.md, "Project status" and "Per-project notes".

---

## 4. Technology and dependencies

All projects declare these `devDependencies`:

| Package | Declared version | Notes |
|---|---|---|
| `@playwright/test` | `^1.52.0` (7 projects), `1.61.1` exact (Turn2US) | Turn2US also has `"overrides": { "playwright-core": "1.61.1" }` |
| `@axe-core/playwright` | `^4.11.2` | Accessibility scans in nonfunctional specs |
| `exceljs` | `^4.4.0` | Findings reporter |
| `dotenv` | `^16.4.5` | TFS only |

- Because of the caret ranges, the **installed** Playwright version differs per project. On 2026-10-27 the installed versions were: PBS 1.58.2, Withers 1.59.1, CareUK 1.60.0, MCC 1.61.1, RSC 1.61.1, Turn2US 1.61.1, NPL 1.62.0, TFS 1.62.1.
- k6 is a separate binary, not an npm package.
- **Working note:** a fresh `npm install` with a caret range can resolve to a Playwright version whose browser build isn't cached yet. Every test then fails with "Executable doesn't exist". The fix the maintainer used:
  1. Run `npx playwright install`. It can take 1–2 minutes on this network.
  2. If more than one copy of `playwright-core` appears in `node_modules`, pin it exactly and add the `overrides` entry.
  3. Confirm with a real `npx playwright test` run, not `--list`, which doesn't launch browsers.

---

## 5. Architecture

### 5.1 Design principles (as documented and as visible in the code)

1. **Self-contained projects.** Each client folder has its own `package.json`, config, reporter and helpers. No file uses `require('../...')`, and nothing is imported from `Shared/`. Any project can be copied, run or handed off on its own.
2. **Black-box testing of deployed environments.** Paths are relative to `baseURL`. Specs also use Playwright's `request` fixture, or Node's `http`/`https` modules, for HTTP-level checks such as headers, sitemaps and link status.
3. **No page-object model, no custom fixtures.** There is no `test.extend` anywhere. Each spec is a procedural script with local helper functions and constant arrays at the top of the file.
4. **Deliberate local duplication.** Small helpers are copied into each spec rather than shared. PBS's Copilot instructions say "current style duplicates small helpers intentionally". The new-project checklist says "Keep shared logic lightweight unless a clear reuse case appears." The most-duplicated helpers, with approximate copy counts:
   - `dismissCookieOverlayIfPresent` (62)
   - `clickWithCookieGuard` (55)
   - `acceptCookiesIfPresent` (43)
   - `waitForAndAcceptCookieBanner` (34)
   - `openMenuIfPresent` (29)
   - `normalizeWhitespace` (21)
5. **Shared modules only for proven reuse within one project.** These are RSC's link-navigation helpers and TFS's login, portal and history-table helpers (§8).
6. **Findings are first-class.** Failing tests are written to be read by non-technical people: plain-English assertion messages, the failure-context hook, and the Excel reporter. Real site defects are kept as failing tests on purpose.
7. **Hardcoded expectations come from probing.** Spec headers record what was "confirmed via direct probing" and when. Constants (`TOP_LEVEL_NAV_ITEMS`, `PAGES_TO_COMPARE`, and so on) list real paths and labels.

### 5.2 Run-time data flow

```
playwright.config.js (baseURL from <CLIENT>_BASE_URL or default)
        │
        ├─ [TFS only] globalSetup → logs in → auth/storageState.json
        ▼
spec files × 3 device projects ──► each test
        │                              └─ on failure, the afterEach hook attaches "failure-context" JSON
        ▼                                 (url, pageTitle, environment, viewport[, compareEnvironment])
reporters:
   ├─ html → playwright-report/
   └─ ./reporters/findings-reporter.js → findings-report.xlsx
                                       + findings-reports/findings-<ISO timestamp>.xlsx
traces (on first retry) → test-results/
```

---

## 6. Playwright configuration

All 8 `playwright.config.js` files share this shape (PBS shown, trimmed):

```js
const DEFAULT_BASE_URL = 'https://<default env>/';
module.exports = defineConfig({
    testDir: './',                      // flat: every *.spec.js at project root
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['html'], ['./reporters/findings-reporter.js']],
    projects: [
        { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'tablet-webkit',    use: { ...devices['iPad Pro 11'] /* see below */ } },
        { name: 'mobile-chromium',  use: { ...devices['Pixel 7'] } },
    ],
    use: {
        trace: 'on-first-retry',
        actionTimeout: 15000,
        navigationTimeout: 30000,
        storageState: undefined,
        baseURL: process.env.PBS_BASE_URL || DEFAULT_BASE_URL,
    },
});
```

Differences between projects:

| Item | Detail |
|---|---|
| `tablet-webkit` browser | Withers, CareUK, MCC, RSC, NPL and TFS add `browserName: 'chromium'`, so their "tablet-webkit" actually runs Chromium with iPad emulation. **Only PBS and Turn2US run real WebKit.** The project name is the same everywhere because the reporter maps it to "Tablet". |
| `DEFAULT_BASE_URL` constant | Present in PBS, CareUK, MCC, RSC, TFS and Turn2US. Withers and NPL put the default inline in `baseURL`. |
| `storageState` | `undefined` in most projects. NPL omits the key. TFS points it at `auth/storageState.json`. |
| `globalSetup` | TFS only (`./global-setup.js`). TFS's config also calls `require('dotenv').config()`. |

There is no `testMatch` override, so Playwright's default `*.spec.js` / `*.test.js` matching applies. The k6 files (`*.load.k6.js`) aren't picked up. Any temporary `_probe.spec.js` at a project root **is** picked up.

---

## 7. Test suite anatomy

### 7.1 Spec file structure

The order is the same everywhere:

1. `const { test, expect } = require('@playwright/test');`. Some files also import `devices`, `request`, `AxeBuilder`, `http`/`https`, or a local helper module.
2. The **failure-context `afterEach` hook**, copied verbatim. All 106 spec files have it.
3. A **Coverage notes** header block with:
   - scope
   - confirmed facts with dates
   - upper-case labelled sections such as `KNOWN ISSUE`, `CONFIRMED DEFECT (...)`, `ENVIRONMENT DRIFT`, `LIVE SUBMISSION GATING`, `IMPORTANT`
   - the test list
4. Constants: paths, labels, selectors.
5. Local helper functions.
6. Tests: top-level `test()`, or `test.describe()` blocks in larger or newer specs.

### 7.2 Conventions inside tests

- **Titles.** `<Area> - <What is checked>`: 684 of the 756 top-level test titles use the `" - "` separator. Turn2US's newest spec uses `test.describe('Get Support - <Destination>')`, with tests named `Initial Page Load Tests` and `<Thing> Traversal`. HANDOVER.md asks for this naming in future specs.
- **Steps.** `test.step()` appears more than 2,100 times across 99 files.
- **Assertion messages.** The second argument to `expect()` is a plain-English sentence. The reporter uses it as "Why it's an issue". The reporter's plain-language swaps (`404` becomes 'a "page not found" error', `URL` becomes "web address", and so on) only work well if messages are written in normal prose.
- **Async state.** `expect.poll()` is used in 72 files. `expect.soft()` is used in 15 files, mostly where one test reports several independent findings, such as envcompare.
- **Waits.** The standard pattern is `goto` with `waitUntil: 'domcontentloaded'`, then `waitForLoadState('load').catch(() => {})`, then the cookie banner, then assertions. `networkidle` is used before reading menus or positions. `waitForTimeout` shows up in 65 files as short settle delays after menu toggles and similar actions.
- **Responsive UI.** Helpers open a hamburger or filter panel only if it is visible (`openMenuIfPresent`, `openMobileMenuIfPresent`). Desktop-only features are skipped on other viewports with a reason.
- **`test.skip` usage** (195 calls). Each one has a reason string. They fall into a few documented categories:
  - device-independent checks gated to `desktop-chromium`
  - a page or menu item not present on this environment (environment drift)
  - reCAPTCHA in headless mode
  - Live submission gating
  - the envcompare opt-in
  - lenient structured-data checks when no environment exposes JSON-LD

  Skips are **not** used to hide real defects. See HANDOVER.md, "Conventions worth keeping".
- **Serial mode.** Used only in `TFS/02-tfs.dashboard.spec.js`, because of shared server-side account state.

### 7.3 Spec categories

| Category | Files | What it covers |
|---|---|---|
| Content and journey specs | `01`–`NN` | Homepage, meganav (expanding every level and navigating every link), footer (every link, social links), search (empty query, results/no results, pagination, sort), then one spec per site section. Checks include page loads, titles, H1s, CTAs, cards, accordions, filters, forms, embedded video and link traversal. |
| Envcompare | `NN-<client>.envcompare.spec.js` (not Turn2US) | Diffs **two** environments: page title and status parity per page, header/footer/meganav order, security and caching headers, cookie shape, robots.txt Sitemap lines, sitemap parity, analytics container ID (hard assertion; a shared GTM container pollutes analytics), og:image and JSON-LD, favicon, broken images. The whole file is skipped unless `<CLIENT>_COMPARE_BASE_URL` is set. |
| Nonfunctional | `NN-<client>.nonfunctional.spec.js` | **Non-Functional:** sitemap, robots.txt, canonical and robots meta, core meta and Open Graph, GTM/GA signal, CSP and security headers, language alternates or `lang`, mixed content, JSON-LD validity, head essentials. **Accessibility:** axe (`wcag2a`, `wcag2aa`) on key pages, failing on `critical` only (TFS uses `critical` + `serious`, documented in its header), landmarks, a single H1, accessible names, image alt text, form labels. TFS's version covers security hardening and an axe sweep across all portal pages instead of SEO. |
| Load | `NN-<client>.load.k6.js` | See §10. |

---

## 8. Reusable components

| Component | Location | Purpose |
|---|---|---|
| Failure-context hook | top of every spec | Attaches `{url, pageTitle, environment, viewport}` as JSON when a test fails, for the reporter |
| Findings reporter | `Projects/<Client>/reporters/findings-reporter.js` | Writes the Excel findings report (§12) |
| `submissionCounter.js` | each project | `getCurrentSubmissionNumber()` and `incrementSubmissionNumber()`, backed by `submission-counter.txt` (defaults to 1 if the file is missing, as in NPL). Produces unique, obviously fake form data on each run. **Documented** for TFS: the counter advances once per device project, not once per command. |
| `linkNavigationHelpers.js` | RSC | `collectNavigableElements`, `sampleUpToSix`, `verifyPageLinksNavigateCorrectly`, `isErrorPage`: sampled click-through link verification. Used by 10 RSC specs. |
| `global-setup.js` | TFS | Logs in once through the real UI at `/portal/login` using `TFS_EMAIL` and `TFS_PASSWORD`. Waits for the exact dashboard pathname and `networkidle`, checks the title contains "dashboard", then saves `auth/storageState.json`. Throws immediately if the credentials are missing. |
| `login-helpers.js` | TFS | `LOGIN_PATH`, `DASHBOARD_PATH`, `AUTH_ERROR_MESSAGE`, `SELECTORS`, `submitLogin()`, `isLiveEnvironment(baseURL)` (true unless the host contains `tfs-qa`) |
| `portal-helpers.js` | TFS | `HEADER_SELECTORS`, `SIDEBAR_SELECTORS`, `isSidebarCollapsed`, `navigateViaSidebar`, `isBeforeInDom`, `selectAccount` |
| `history-table-helpers.js` | TFS | Shared History-table and filter mechanics: sort dropdown, column reading, waiting for the filter to settle, UK date and currency parsing, the react-datepicker `pickCalendarDate`, `clearFilter` |
| Cookie helpers | local, in each spec | OneTrust and Cookiebot accept/dismiss, with `expect.poll` retry; `clickWithCookieGuard` retries a click with `force: true` when an overlay intercepts it |
| `isQaEnvironment(baseURL)` | local, in RSC specs | Gates real form submissions to the QA host |

---

## 9. Test data

- **Expected values are hardcoded constants** taken from probing the real site: nav labels and hrefs, page paths, titles, footer link lists, and the curated `PAGES_TO_COMPARE` and `KEY_PATHS_FOR_IMAGE_SWEEP` in envcompare specs. When the site changes, update the constants and the dated header notes together.
- **Form data** is generated from `submissionCounter.js`. Real submissions happen only on QA-type environments. Live forms are validated up to "submittable" and never sent.
- **TFS live account data.**
  - The suite runs against a real customer-portal login and live data.
  - **Documented:** totals and counts can change mid-test, so re-read them at the point of use.
  - Some tests switch to specific accounts because the default account's data is too thin to exercise some features, then restore the default account in a file-level `afterAll`.
- **Credentials** exist only for TFS. They come from `.env` (gitignored; copy `.env.example`) locally, or from the `TFS_EMAIL` and `TFS_PASSWORD` secrets in TFS's workflow file. See §14 for a hardcoded-fallback exception found in one spec.

---

## 10. Load testing (k6)

- **Location.** One file per project, `NN-<client>.load.k6.js`. ES modules (`import http from 'k6/http'`).
- **Base URL.**
  - CareUK, MCC, NPL, RSC, Turn2US and Withers: `__ENV.BASE_URL || __ENV.<CLIENT>_BASE_URL || __ENV.K6_BASE_URL`. These also derive `ORIGIN` for root-level `/robots.txt` and `/sitemap.xml` checks.
  - **PBS and TFS read `BASE_URL` only.**
  - The script throws if no base URL is set.
- **Scenarios.** `--env SCENARIO=smoke|load|spike|soak|all` (default `all`). PBS's QUICK GUIDE describes them:

  | Scenario | Executor and shape | Duration |
  |---|---|---|
  | smoke | `per-vu-iterations`, 2 VUs × 5 iterations | max 2 m |
  | load | ramp 1 → 10 VUs over 2 m, hold 5 m, ramp down 2 m | ~9 m |
  | spike | 1 → 40 VUs in 30 s, hold 2 m, back down in 30 s | ~3 m |
  | soak | 5 constant VUs | 10 m |

- **Thresholds**, identical in all 8 projects: `http_req_failed rate<0.02`, `http_req_duration p(95)<1500`, `http_req_waiting p(95)<1000`, `errors rate<0.02`. Custom metrics: `errors` (Rate), `ttfb_ms` and `duration_ms` (Trend).
- **Journeys.** `browseCorePages()` requests the core pages plus one random extra page. TFS instead has `setup()` (login) and `browsePortalPages`, pins `tlsVersion` to TLS 1.2, and reads cookies via `res.cookies`. **Working note:** both TFS choices were needed to make the login-gated load test work.
- **Output.** `handleSummary()` prints a "Final verdict" (PASS or FAIL), a gate result per threshold, the main health metrics, and failing checks. It writes `k6-summary.json` (gitignored).
- **npm scripts.** `load:smoke`, `load:load`, `load:spike`, `load:soak` and `load:all` don't pass a URL. Use `npm run load:smoke -- --env BASE_URL=https://...` or set the env var.
- **Rule.** Run load, spike and soak only against UAT or QA, never Live. This is the "hard rule" in `Shared/todo.md`.

---

## 11. Test execution

### 11.1 Local

Run from inside `Projects/<Client>/`:

| Command | What it does |
|---|---|
| `npm install` then `npx playwright install` | One-time setup |
| `npm test` | `npx playwright test -c .`: all specs × 3 device projects, headless |
| `npm run test:headed` / `npm run test:ui` | Headed run / Playwright UI mode |
| `npm run test:nonfunctional` | Nonfunctional spec only (all projects) |
| `npm run test:envcompare` | Envcompare spec (all except Turn2US); also needs `<CLIENT>_COMPARE_BASE_URL` |
| `npm run test:stable` | TFS only: `--workers=1` |
| `npx playwright test <file> --project=desktop-chromium -g "<title>"` | Narrow a run |

To switch environments, change `DEFAULT_BASE_URL` (or the inline `baseURL`) in the config for a lasting change, or set the env var for a one-off run:

```powershell
$env:PBS_BASE_URL = 'https://www.principality.co.uk/'
npm test
```

Documented operating advice (HANDOVER.md):

- Use `--workers=2` for full local runs of the bigger suites.
- Never run two environments of one project at once.
- Check for stray `chrome.exe` and `node.exe` processes before treating a wave of timeouts as real.

### 11.2 VS Code

- Open [Projects/automation-tests.code-workspace](Projects/automation-tests.code-workspace). It is a multi-root workspace with one root per client plus `Shared`, and it carries the Test Explorer settings (`editor.codeLens`, `testing.gutterEnabled`, and so on).
- A project that is missing from that file doesn't appear in Explorer or Test Explorer.
- For other Test Explorer problems, see section 10 of the new-project checklist.

### 11.3 CI

- Each project has `.github/workflows/playwright.yml`: Ubuntu, Node 20.x, `npm ci`, `npx playwright install --with-deps`, `npx playwright test`, then upload `playwright-report`. TFS's workflow also injects `TFS_EMAIL` and `TFS_PASSWORD` from secrets.
- **None of these workflows has ever run**, because GitHub only reads `.github/workflows/` at the repo root.
- In CI mode the config sets `retries: 2`, `workers: 1` and `forbidOnly`.
- The planned TeamCity → Octopus post-deploy gate (smoke on every environment, load on UAT/QA only, JUnit output, a `@smoke` tag subset) is in `Shared/todo.md`. **No `@smoke` tags exist yet.**

---

## 12. Reporting

| Output | Location | Notes |
|---|---|---|
| Playwright HTML report | `playwright-report/` | `npx playwright show-report` |
| Traces | `test-results/` | `trace: 'on-first-retry'`, so traces are only recorded when retries are on (CI). For a local trace, add `--trace on` or `--retries=1`. |
| Findings report | `findings-report.xlsx` (latest) and `findings-reports/findings-<timestamp>.xlsx` (archive) | Written by `reporters/findings-reporter.js` in `onEnd` |
| k6 summary | `k6-summary.json` and console verdict | From `handleSummary()` |

### Findings reporter internals

The reporter is identical in all 8 projects apart from:

- the `FRIENDLY_FILE_NAMES` map
- the `workbook.creator` and title strings
- the TFS header colour (`FF049EE0`; the others use `FF041E42`)
- comments

How it works:

- **`onTestEnd`:**
  - Passed and skipped tests go only to "All Tests".
  - Failed, timed-out and interrupted tests become findings. Each finding has:
    - a friendly spec name (from `FRIENDLY_FILE_NAMES`, falling back to the file name)
    - the test title
    - "Seen on" (`FRIENDLY_PROJECT_NAMES`: Desktop, Tablet, Mobile, plus the environment)
    - the URL (from the `failure-context` attachment, or "Not captured" if the test failed before the hook could record it)
    - "Why": the first line of the first error, with ANSI codes stripped and `PLAIN_LANGUAGE_SWAPS` applied
- **Sheets:**
  - **Summary:** checks run, passed, findings to review.
  - **Findings:** frozen header, filterable, clickable URLs.
  - **All Tests:** every result with a colour-coded status.
- Project READMEs still describe only the first two sheets.
- **Pitfalls** (HANDOVER.md):
  - `--reporter=list` on the CLI disables this reporter silently.
  - `--list` runs it and overwrites the report with an empty one.
  - Concurrent runs corrupt it.

---

## 13. Debugging

1. **Reproduce narrowly.** Use one file, one project, and `-g` with the title, in `--headed` or `--ui` mode.
2. **Read the spec's Coverage notes header.** The failure may be a documented, deliberately failing site defect, or environment drift that is expected to fail.
3. **Inspect the evidence.** Use the HTML report, then a trace (`--trace on`), then the findings row, which shows the URL at the moment of failure.
4. **Probe the live page** with a throwaway script, or a temporary `_probe.spec.js` that you delete afterwards, to confirm selectors and values fresh before deciding between "site defect" and "test bug".
5. **Rule out the environment.** Check for stray browser processes, reduce workers, retry once (Turn2US Staging, for example, was once 10× slower than normal), and confirm the base URL is reachable.
6. **Common root causes**, documented in HANDOVER.md, with the working notes marked:

| Root cause | Source |
|---|---|
| OneTrust Accept clicked before its handler attaches | Documented |
| Mega-menus or positions read before `networkidle` | Documented |
| `page.waitForURL(predicate)` receives a **URL object**, so compare `url.href` or `url.pathname`, never the bare object | Documented |
| Conditionally rendered widgets keep reflowing the page after `load`; wait for `networkidle` before `boundingBox()` | Working note |
| Recharts-style charts with sparse x-axes: scan several hover positions instead of one fixed point | Working note |
| A single-field "fingerprint" or an early-read count goes stale on live data; compare several fields and re-read at the point of use | Working note |
| Same-credential logins share one server-side session (TFS), so a new browser context doesn't isolate tests | Documented |
| Browser executable missing after `npm install` resolved a newer Playwright | Documented / Working note |

---

## 14. Known issues and inconsistencies (verified 2026-10-27)

| # | Issue | Where |
|---|---|---|
| 1 | **Hardcoded fallback credentials** in a committed spec (`VALID_EMAIL` and `VALID_PASSWORD` default values). This contradicts the TFS README's claim that credentials are never hardcoded. | `Projects/TFS/01-tfs.login.spec.js` ~L55–56 |
| 2 | CI workflows are in subfolders and have never run | `Projects/*/.github/workflows/` |
| 3 | Playwright declared as `^1.52.0` in 7 projects, exact `1.61.1` in Turn2US; installed versions range from 1.58.2 to 1.62.1 | `package.json` files |
| 4 | `tablet-webkit` actually runs Chromium in 6 of 8 projects | configs |
| 5 | Small config shape differences (no `DEFAULT_BASE_URL` constant in Withers and NPL; no `storageState` key in NPL) | configs |
| 6 | Reporter copied 8 times; logic identical, but changes must be applied to every copy | `reporters/` |
| 7 | PBS Copilot instructions are stale (old file numbers 09/10; "manually switched baseURL") | `Projects/PBS/.github/copilot-instructions.md` |
| 8 | READMEs say the findings workbook has 2 sheets; it has 3 | project READMEs |
| 9 | Generated files committed | `Projects/k6-summary.json`, `Projects/NPL/k6-run-output.log` |
| 10 | HANDOVER.md says the reporter copies have diverged "beyond" `FRIENDLY_FILE_NAMES`; the only other differences are the title, creator and TFS colour | HANDOVER.md, open-work item 4 |
| 11 | Turn2US has no envcompare spec; its nonfunctional and k6 coverage is homepage-only | `Projects/Turn2US/` |
| 12 | PBS's and TFS's k6 scripts ignore `<CLIENT>_BASE_URL` (they need `BASE_URL`) | `15-pbs.load.k6.js`, `14-tfs.load.k6.js` |

The documented site defects (failing tests on purpose) are listed per project in HANDOVER.md and in each spec's header. They are not repeated here because they change as the clients fix them.

---

## 15. Maintenance practices (documented)

- Keep the project patterns aligned: naming, config shape, reporter, hook.
- When adding or renumbering a spec, update the `package.json` scripts, the README list, `FRIENDLY_FILE_NAMES` and the k6 QUICK GUIDE. Register new projects in `automation-tests.code-workspace`.
- Keep each spec's Coverage notes header current, with dates, when behaviour or defects are confirmed or retracted. Examples in the repo:
  - Withers: a Vimeo CSP finding was retracted.
  - CareUK: the `CurrentContact` cookie was confirmed by Dev as not a bug, so it shouldn't be raised again.
- Re-verify fixed defects against the environment and record the result in the header and in HANDOVER.md.
- Never delete `findings-reports/`. Generated outputs stay gitignored.
- Client-facing coverage documents go in `<Project>/QA Test Coverage/`.
- Commits in this repo are periodic snapshots on `main` with the message `update DD.MM.YYYY`.

---

## 16. Design decisions you can trace in the repo

| Decision | Evidence |
|---|---|
| One self-contained project per client, same structure | `Shared/README.md` "Cross-project consistency"; new-project checklist |
| Plain-language Excel findings report for non-technical readers | Reporter header comment; checklist §8 |
| Assertion messages double as the finding explanation | Checklist §8 |
| Real defects stay as failing tests | HANDOVER.md "Conventions worth keeping" |
| One spec file per page, including its sub-panels | HANDOVER.md |
| Helpers duplicated locally rather than shared | PBS `copilot-instructions.md`; checklist §6 |
| Envcompare is opt-in, one test per page, curated page list | `13-pbs.envcompare.spec.js` header |
| Device-independent checks run on desktop only | envcompare and nonfunctional spec headers |
| axe fails on `critical` only; TFS widened to `serious` | nonfunctional specs; `TFS/README.md` |
| TFS logs in once via `globalSetup` and `storageState` | `global-setup.js` header |
| No real form submission on Live | `TFS/README.md`; RSC `isQaEnvironment`; spec skip reasons |
| k6 file structure (QUICK GUIDE, 5 scenarios, rich `handleSummary`) | Checklist §9 |
| Load, spike and soak never run against Production | `Shared/todo.md` |

No other historical rationale is recorded in the repo, and none is assumed here.

---

## 17. Recommendations (not current practice)

- **Recommendation:** remove the hardcoded TFS fallback credentials, rely only on `.env` and CI secrets, and rotate the password, because it remains in git history.
- **Recommendation:** pin `@playwright/test` exactly (with an `overrides` entry for `playwright-core`) in every project, following Turn2US.
- **Recommendation:** make CI real, either with a root-level GitHub workflow per project (`working-directory`) or with the TeamCity → Octopus plan in `Shared/todo.md`. Add JUnit output and `@smoke` tags as that plan describes.
- **Recommendation:** fix the stale documentation (PBS Copilot instructions, the README sheet counts) and untrack the two generated files.
- **Recommendation:** rename `tablet-webkit`, or remove the `chromium` override, so the project name matches the browser. This affects the reporter's `FRIENDLY_PROJECT_NAMES` and skip conditions that check `project.name`, so change it everywhere at once.
- **Recommendation:** add `BASE_URL || <CLIENT>_BASE_URL || K6_BASE_URL` resolution to PBS's and TFS's k6 scripts, for consistency.
- **Recommendation:** if the reporter is consolidated into `Shared/`, keep per-project `FRIENDLY_FILE_NAMES` and titles as configuration.

## 18. Notes for an AI assistant taking over

- Start with [AGENTS.md](AGENTS.md), then the project README, then the header of the spec you're touching.
- `.claude/` folders and `Projects/PBS/.claude/settings.local.json` belong to the previous tool (Claude Code). They are gitignored or excluded and aren't part of the framework.
- Tests need outbound network access to the client environments. Without it, every test fails at navigation.
- The original maintainer preferred visible, sequential work over many quiet parallel background jobs when sweeping many files. They also asked for every finding to be re-verified before it was reported as a defect.
