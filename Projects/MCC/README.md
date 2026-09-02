# MCC automation suite

QA automation for Lord's Cricket Ground / MCC (lords.org), built to match the CareUK/Withers/PBS Playwright + k6 structure so it can live independently in the same multi-root workspace.

## What's covered

- `01-mcc.homepage.spec.js` — Homepage
- `02-mcc.meganav.spec.js` — Main menu (meganav)
- `03-mcc.footer.spec.js` — Footer
- `04-mcc.search.spec.js` — Site search
- `05-mcc.visitlords.spec.js` — Visit Lord's
- `06-mcc.tickets.spec.js` — Tickets
- `07-mcc.hospitalityandexperiences.spec.js` — Hospitality & Experiences
- `08-mcc.playandtrain.spec.js` — Play & Train
- `09-mcc.mcc.spec.js` — MCC (The Club)
- `10-mcc.shop.spec.js` — Shop
- `11-mcc.more.spec.js` — More menu
- `12-mcc.sponsors.spec.js` — Sponsors
- `13-mcc.womensinternationals.spec.js` — Women's Internationals
- `14-mcc.envcompare.spec.js` — Environment comparison (two-environment discrepancy checks; only runs when `MCC_COMPARE_BASE_URL` is set — see [Comparing two environments](#comparing-two-environments) below)
- `16-mcc.nonfunctional.spec.js` — SEO / security / accessibility
- `15-mcc.load.k6.js` — k6 load test scaffold

Every spec file's own header comment (a "Coverage notes" box right below the imports) lists its exact test list and any confirmed defects/environment differences — read that first before changing a file.

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke -- --env BASE_URL=https://lords-uat2.hosted.positive.co.uk`

## Comparing two environments

`14-mcc.envcompare.spec.js` is different from every other spec in this project: it doesn't test one environment, it **diffs two of them** — page titles sitewide, meganav/footer/eyebrow-nav structure and order, the homepage hero carousel, HTTP response headers, robots.txt/sitemap health, the GTM/analytics container ID, and SEO metadata (og:image, JSON-LD).

It's opt-in and skips itself cleanly on a normal run: it only executes when `MCC_COMPARE_BASE_URL` is set, alongside the usual `MCC_BASE_URL` for the first environment. `npm test` / CI runs never need to set this, so this file always shows as skipped there — that's expected, not a problem.

PowerShell example (compares UAT2 against Live):

```powershell
$env:MCC_BASE_URL = 'https://lords-uat2.hosted.positive.co.uk'
$env:MCC_COMPARE_BASE_URL = 'https://www.lords.org'
npm run test:envcompare
```

Findings are written into the same `findings-report.xlsx` as any other run, with the "Where" column showing which of the two environments the specific issue was seen on. This file grew out of a manual UAT2-vs-Live comparison pass done directly in conversation with Claude (2026-09) — see the project's memory notes for the original write-up this spec automates.

## Environment

The default environment is controlled from [playwright.config.js](playwright.config.js) via `DEFAULT_BASE_URL`.

Current default:

- `https://lords-uat2.hosted.positive.co.uk/`

When you want the project to point somewhere else by default, change that one value in [playwright.config.js](playwright.config.js).

For one-off terminal runs, `MCC_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:MCC_BASE_URL = 'https://www.lords.org'
npx playwright test
```

## Findings report (for sharing with the team)

Every test run automatically produces a plain-language findings spreadsheet, in addition to the usual Playwright HTML report:

- `findings-report.xlsx` — open in Excel (or Google Sheets/Numbers), share the file directly (e.g. email/Teams/Slack attachment)
- `findings-reports/` — a timestamped copy is kept here after every run, so past runs aren't overwritten

The workbook has two sheets:

- **Summary** — checks run, passed, and how many findings need review
- **Findings** — one row per failing/needs-attention test, filterable/sortable, with columns for:
  - **Where (page address)** — the exact page the issue was seen on (clickable link)
  - **Which page/feature** — the site area it belongs to (e.g. Shop, Tickets, Footer)
  - **Why it's an issue** — a plain-English description, without test/code jargon

Passing tests aren't listed row-by-row - they're just counted in the Summary sheet. This is powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a small `test.afterEach` hook at the top of every spec file, which records the page address whenever a test fails. Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.

## Notes

- `submissionCounter.js` / `submission-counter.txt` drive unique, rotating test data for the form-submission tests (Debentures, Seasonal Suites, Old Clock Tower Club enquiries) so repeated runs don't resubmit identical data.
- Real Google reCAPTCHA v2 forms skip their "successful submission" test outright in headless runs (`testInfo.project.use?.headless !== false`), since solving it needs a real headed session.
