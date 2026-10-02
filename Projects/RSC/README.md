# RSC automation suite

QA automation for the Royal Society of Chemistry (rsc.org), built to match the CareUK/Withers/PBS/MCC Playwright + k6 structure so it can live independently in the same multi-root workspace.

## What's covered

- `01-rsc.homepage.spec.js` — Homepage
- `02-rsc.meganav.spec.js` — Main menu (meganav)
- `03-rsc.footer.spec.js` — Footer
- `04-rsc.search.spec.js` — Site search
- `05-rsc-membership.spec.js` — Membership
- `06-rsc.publishing.spec.js` — Publishing
- `07-rsc.policyandcampaigning.spec.js` — Policy and campaigning
- `08-rsc.standardsandrecognition.spec.js` — Standards and recognition
- `09-rsc.fundingandsupport.spec.js` — Funding and support
- `10-rsc.eventsandvenuehire.spec.js` — Events and venue hire
- `11-rsc.news.spec.js` — News
- `12-rsc.aboutus.spec.js` — About us
- `13-rsc.contactus.spec.js` — Contact us
- `14-rsc.helpandlegal.spec.js` — Help and legal
- `15-rsc.envcompare.spec.js` — Environment comparison (two-environment discrepancy checks; only runs when `RSC_COMPARE_BASE_URL` is set — see [Comparing two environments](#comparing-two-environments) below)
- `16-rsc.nonfunctional.spec.js` — SEO / security / accessibility
- `17-rsc.load.k6.js` — k6 load test scaffold

Every spec file's own header comment (a "Coverage notes" box right below the imports) lists its exact test list and any confirmed defects/environment differences — read that first before changing a file.

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke -- --env BASE_URL=https://qa-rsccorp-fa30c0.xperience-sites.com`

## Comparing two environments

`15-rsc.envcompare.spec.js` is different from every other spec in this project: it doesn't test one environment, it **diffs two of them** — page titles sitewide, meganav/footer/header-utility-link structure and order, HTTP response headers, cookies, robots.txt/sitemap health, the GTM/analytics container ID, and SEO metadata (og:image, JSON-LD).

It's opt-in and skips itself cleanly on a normal run: it only executes when `RSC_COMPARE_BASE_URL` is set, alongside the usual `RSC_BASE_URL` for the first environment. `npm test` / CI runs never need to set this, so this file always shows as skipped there — that's expected, not a problem.

PowerShell example (compares QA against Live):

```powershell
$env:RSC_BASE_URL = 'https://qa-rsccorp-fa30c0.xperience-sites.com'
$env:RSC_COMPARE_BASE_URL = 'https://www.rsc.org'
npm run test:envcompare
```

Findings are written into the same `findings-report.xlsx` as any other run, with the "Where" column showing which of the two environments the specific issue was seen on. Note (confirmed 2026-09-02): Live currently serves an automated "Are you human?" bot-verification wall to both plain HTTP requests and headless browsers, so a real run against Live will likely show near-total failures until that's resolved on Live's end — see the spec file's own "Coverage notes" header for details, that's a known infrastructure caveat rather than a bug in this spec.

## Environment

The default environment is controlled from [playwright.config.js](playwright.config.js) via `DEFAULT_BASE_URL`.

Current default:

- `https://qa-rsccorp-fa30c0.xperience-sites.com/` (QA)

Live environment:

- `https://www.rsc.org/`

When you want the project to point somewhere else by default, change that one value in [playwright.config.js](playwright.config.js).

For one-off terminal runs, `RSC_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:RSC_BASE_URL = 'https://www.rsc.org'
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
  - **Which page/feature** — the site area it belongs to (e.g. Membership, News)
  - **Why it's an issue** — a plain-English description, without test/code jargon

Passing tests aren't listed row-by-row - they're just counted in the Summary sheet. This is powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a small `test.afterEach` hook at the top of every spec file, which records the page address whenever a test fails. Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.

## Notes

- `submissionCounter.js` / `submission-counter.txt` are ready for whichever future form-submission spec needs unique, rotating test data (no submission specs exist yet).
- No cookie-consent banner (e.g. OneTrust) was observed on a first pass of either environment as of 2026-07-20 - the dismissal helper in `01-rsc.homepage.spec.js` is kept anyway (matching the convention across other client projects) in case one renders conditionally, and is a no-op otherwise.

## Credits

This suite was designed and built by **Hector Ortega, QA Lead**, in 2026, as part of the shared QA automation workspace (framework, findings reporter, k6 load testing) also designed and built by Hector.
