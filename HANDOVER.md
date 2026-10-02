# QA Automation: Handover

Written 2026-10-02 by **Hector Ortega, QA Lead**, who designed and built this workspace between May and October 2026. It's for whoever picks up the work next. Read it once start to finish, then use each project's own `README.md` for detail.

## What this is

Black-box automated testing for 8 client websites. Each client has its own self-contained project under `Projects/`, containing:

- **Playwright specs** (`NN-<client>.<area>.spec.js`), one file per site section or page, run on desktop, tablet and mobile
- an **envcompare** spec that diffs two environments of the same site (headers, analytics tags, nav, broken images)
- a **nonfunctional** spec covering SEO, security headers and accessibility (axe)
- one **k6 load test** (`NN-<client>.load.k6.js`) with `smoke | load | spike | soak | all` scenarios
- a **findings reporter** that writes a plain-language `findings-report.xlsx` after every run, readable by non-technical people

The tests run against deployed URLs (QA/UAT/Staging/Live). They are not unit tests and don't need the site's source code.

## Getting set up

1. Install **Node.js** (LTS; this machine had v24) and **k6** (for load tests; this machine had v1.7.1).
2. Open `Projects/automation-tests.code-workspace` in VS Code and install the Playwright Test extension.
3. In each project you want to run: `npm install`, then `npx playwright install`.
4. **TFS only:** copy `Projects/TFS/.env.example` to `.env` and fill in the portal login (`TFS_EMAIL`, `TFS_PASSWORD`). The `.env` file is gitignored and has never been committed. Get the credentials from the TFS project team.
5. Run: `npm test` (headless), `npm run test:headed` (watch it), `npm run load:smoke` (k6).

**Repository:** at handover the git remote was `github.com/irreverse-jpg/Automation`, a personal GitHub account. Check with your manager that it has been transferred to a company-owned GitHub organisation, so you have access and the history is kept.

## Project status

To switch environments, set the env var or change `DEFAULT_BASE_URL` in that project's `playwright.config.js`. The default (bold) is the environment the suite was mainly built against. Specs counts exclude the k6 file.

| Project | Site | Environments (env var) | Specs | Status | Latest findings report |
|---|---|---|---|---|---|
| **PBS** | principality.co.uk | QA, **QA2**, UAT2, Live (`PBS_BASE_URL`) | 14 | Complete | 2026-08-26 |
| **Withers** | withersworldwide.com | **UAT**, XbyK, Live (`WITHERS_BASE_URL`) | 14 | Complete | 2026-09-28 |
| **CareUK** | careuk.com | **UAT2**, XbyK, Live (`CAREUK_BASE_URL`) | 16 | Complete | 2026-09-21 |
| **MCC** | lords.org | **UAT2**, Live (`MCC_BASE_URL`) | 15 | Complete | 2026-08-26 |
| **RSC** | rsc.org | **QA**, Live (`RSC_BASE_URL`) | 16 | Complete | 2026-08-26 |
| **NPL** | npl.co.uk | **UAT**, Live (`NPL_BASE_URL`) | 12 | Complete | 2026-08-25 |
| **TFS** | thefuelstore.co.uk (login-gated portal) | **QA**, Live (`TFS_BASE_URL`) | 13 | Complete | none archived |
| **Turn2US** | turn2us.org.uk | **Staging**, UAT, Live (`TURN2US_BASE_URL`) | 6 | **In progress** (see below) | 2026-09-25 |

Past findings reports are kept in each project's `findings-reports/` folder. The client-facing **QA Test Coverage Overview** (.docx) is in each project's `QA Test Coverage/` folder. Turn2US doesn't have one yet.

### Per-project notes

- **PBS**: 3 tests in `07-pbs.mortgages.spec.js` fail on Live because of a known site issue documented in that file's header. That's the site, not the suite.
- **Withers**: a full Live-vs-XbyK comparison was run on 2026-09-25 and written up in `Withers - Live vs XbyK Environment Comparison Report.docx` (project root). Headlines: Live and XbyK fire into the same Google Tag Manager container, and XbyK has two accessibility regressions (no `lang` on `<html>`, no main landmark). A Vimeo CSP finding was later retracted (no impact).
- **CareUK**: most of the 2026-08/09 XbyK-vs-Live findings were fixed by Dev and re-verified on 2026-09-23. The XbyK `CurrentContact` cookie is a platform default that Dev confirmed is not a bug, so don't re-raise it. Same cookie on Withers XbyK.
- **MCC**: real defects are left as deliberately failing assertions. Each spec's header lists them.
- **RSC**: a confirmed sitewide accessibility defect (`aria-expanded` on the header search input) and 15 confirmed broken links, all asserted as failures.
- **NPL**: many UAT meganav links are broken or point to `/`, especially Strategic programmes, Education and learning, and About NPL. These are deliberately failing tests written against Live's correct destinations, so don't "fix" the specs to make them pass. A header background-image fix was retested as fixed on 2026-09-29; the case study theming fix is only partly done.
- **TFS**: unlike the others, it's a logged-in customer portal. `global-setup.js` logs in once and saves the session to `auth/` (gitignored). The selected account in the account dropdown is stored **server-side** and shared by every session using the same login, so tests that switch accounts can affect each other. For a reliable full local run use `npm run test:stable` (one worker). The README explains why.
- **Turn2US**: Cookiebot, not OneTrust, handles cookie consent. The Benefits Calculator's full reference journey is written up in `Projects/Turn2US/docs/benefits-calculator-journey.md`.

## Open work, in suggested order

1. **Turn2US: finish `05-turn2us.getsupport.spec.js`.** PIP Helper stage 3 ("Filling PIP Traversal", `/how-do-you-fill-in-your-pip-form`) is not started. Information about Benefits, Information for your Situation and Turn2us Grants Programmes only have page-load tests. The planned ~10 varied Benefits Calculator journeys are not started. Spec numbers 06–14 are deliberately left free for more "Get support"-style sections.
2. **Turn2US: widen nonfunctional and k6 coverage.** Both currently cover the homepage only. Then write its QA Test Coverage doc.
3. **CI is not actually running.** Each project has `.github/workflows/playwright.yml`, but GitHub only runs workflows from the repo root's `.github/workflows/`, so none of them has ever run. The plan for proper TeamCity → Octopus deployment gating is in `Shared/todo.md` (not started).
4. **The findings reporter has drifted.** The 8 copies of `reporters/findings-reporter.js` are no longer identical. Each has its own `FRIENDLY_FILE_NAMES` map, but the rest has diverged too. Diff them before changing one, and consider moving the shared part into `Shared/`.
5. **Playwright versions are inconsistent.** Turn2US pins `@playwright/test` to an exact `1.61.1`; the others use `^1.52.0`. Exact pinning is safer, because new projects otherwise hit missing-browser-build errors.

## Conventions worth keeping

- **Real defects stay as failing tests.** Never skip or exclude a broken link or page just because there's no working example to compare against. A finding that disappears from the report is a finding nobody fixes.
- **One spec file per page or section**, including its sub-panels (filters, accordions). Don't split one page across files.
- **Spec naming:** `NN-<client>.<area>.spec.js`. Within `05-turn2us.getsupport.spec.js` (Turn2US's newest spec), each destination's standard test is `Initial Page Load Tests` and deeper checks are `<Thing> Traversal`. Use the same naming in future specs.
- When you add or renumber a spec, update `package.json` scripts, the README file list, the reporter's `FRIENDLY_FILE_NAMES`, and the k6 file's own quick-guide comment.
- **Forms:** `submissionCounter.js` and `submission-counter.txt` generate unique test data per run. Forms with real reCAPTCHA skip their successful-submission test when headless. Run headed and solve the CAPTCHA yourself to cover it.
- **Coverage docs** for clients go in `<Project>/QA Test Coverage/`, never the project root.
- **Verify before reporting a defect:** re-check the exact element fresh in the browser before writing a failure up as a site defect. A value copied from an earlier, unrelated probe has been wrong before.

## Gotchas that have cost real time

- **Don't run two environments of the same project at once.** They share `test-results/` and the findings report, and the result is a silently corrupted report (once, a false "0 findings").
- **`--reporter=...` on the command line replaces the configured reporters entirely.** The findings report silently isn't written, and the run still exits 0. If you want `list` output, pass all of them: `--reporter=list,html,./reporters/findings-reporter.js`.
- **`npx playwright test --list` also runs the findings reporter.** It overwrites `findings-report.xlsx` with an empty report and adds an empty copy to `findings-reports/`.
- **Many timeouts at once?** Check Task Manager for leftover `chrome.exe`/`node.exe` processes from earlier runs before blaming the site.
- **Too many parallel workers cause fake timeouts** on the bigger suites. Use `--workers=2` for full local runs.
- **Read menus and positions only after the page settles.** Use `networkidle` plus a short wait before reading mega-menus or measuring element positions; `domcontentloaded` alone gave wrong-direction diffs on Withers.
- **OneTrust (NPL and others):** the Accept button appears before its click handler is attached, so clicking it the instant it's visible does nothing. The specs' dismissal helpers handle this. Reuse them.
- **`page.waitForURL(predicate)` passes a URL object**, not a string.

## Where else to look

- `Shared/README.md`: onboarding and folder layout
- `Shared/docs/new-project-checklist.md`: setting up a new client suite step by step
- `Shared/todo.md`: CI/CD integration plan
- Each spec file's header comment: what it covers, plus known site defects and environment differences for that page. This is usually the most detailed and up-to-date source.
