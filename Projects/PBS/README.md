# PBS automation suite

QA automation for Principality Building Society (principality.co.uk), built to match the MCC/Withers/CareUK Playwright + k6 structure so it can live independently in the same multi-root workspace.

## What's covered

- `01-pbs.homepage.spec.js` — Homepage
- `02-pbs.search.spec.js` — Site search
- `03-pbs.meganav.spec.js` — Main menu (meganav)
- `04-pbs.footer.spec.js` — Footer
- `05-pbs.forms.spec.js` — Mortgage enquiry form
- `06-pbs.branchfinder.spec.js` — Branch finder
- `07-pbs.mortgages.spec.js` — Mortgage products (calculator/listing tool)
- `08-pbs.savings.spec.js` — Compare savings accounts (calculator/listing tool)
- `09-pbs.mortgageguidesandsupport.spec.js` — Mortgages: guides, first time buyers, and managing your mortgage (17 pages)
- `10-pbs.savingsguidesandsupport.spec.js` — Savings: home, guides, ISA transfer, and individual account types (10 pages)
- `11-pbs.helpandsupport.spec.js` — Help and support (10 FAQ-heavy pages)
- `12-pbs.aboutus.spec.js` — About us, careers, and our impact (10 pages)
- `13-pbs.envcompare.spec.js` — Environment comparison (two-environment discrepancy checks; only runs when `PBS_COMPARE_BASE_URL` is set — see [Comparing two environments](#comparing-two-environments) below)
- `14-pbs.nonfunctional.spec.js` — SEO / security / accessibility
- `15-pbs.load.k6.js` — k6 load test scaffold

Every spec file's own header comment (a "Coverage notes" box right below the imports) lists its exact test list and any confirmed defects/environment differences — read that first before changing a file.

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke -- --env BASE_URL=https://pbs-qa2.hosted.positive.co.uk`

## Comparing two environments

`13-pbs.envcompare.spec.js` is different from every other spec in this project: it doesn't test one environment, it **diffs two of them** — page titles sitewide, meganav/footer/header link structure and order, HTTP response headers, cookies, robots.txt/sitemap health, the GTM/analytics container ID, and SEO metadata (og:image, JSON-LD).

It's opt-in and skips itself cleanly on a normal run: it only executes when `PBS_COMPARE_BASE_URL` is set, alongside the usual `PBS_BASE_URL` for the first environment. `npm test` / CI runs never need to set this, so this file always shows as skipped there — that's expected, not a problem.

PowerShell example (compares QA2 against Live):

```powershell
$env:PBS_BASE_URL = 'https://pbs-qa2.hosted.positive.co.uk'
$env:PBS_COMPARE_BASE_URL = 'https://www.principality.co.uk'
npm run test:envcompare
```

Findings are written into the same `findings-report.xlsx` as any other run, with the "Where" column showing which of the two environments the specific issue was seen on.

## Environment

The default environment is controlled from [playwright.config.js](playwright.config.js) via `DEFAULT_BASE_URL`.

Current default:

- `https://pbs-qa2.hosted.positive.co.uk/`

When you want the project to point somewhere else by default, change that one value in [playwright.config.js](playwright.config.js).

For one-off terminal runs, `PBS_BASE_URL` still overrides the config default.

Other known environments (see the comment above `baseURL` in [playwright.config.js](playwright.config.js)):

- QA: `https://pbs-qa.hosted.positive.co.uk/`
- UAT2: `https://pbs-uat2.hosted.positive.co.uk/`
- Live: `https://www.principality.co.uk/`

## Findings report (for sharing with the team)

Every test run automatically produces a plain-language findings spreadsheet, in addition to the usual Playwright HTML report:

- `findings-report.xlsx` — open in Excel (or Google Sheets/Numbers), share the file directly (e.g. email/Teams/Slack attachment)
- `findings-reports/` — a timestamped copy is kept here after every run, so past runs aren't overwritten

The workbook has two sheets:

- **Summary** — checks run, passed, and how many findings need review
- **Findings** — one row per failing/needs-attention test, filterable/sortable, with columns for:
  - **Where (page address)** — the exact page the issue was seen on (clickable link)
  - **Which page/feature** — the site area it belongs to (e.g. Mortgages, Branch Finder, Footer)
  - **Why it's an issue** — a plain-English description, without test/code jargon

Passing tests aren't listed row-by-row - they're just counted in the Summary sheet. This is powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a small `test.afterEach` hook at the top of every spec file, which records the page address whenever a test fails. Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.

## Notes

- `submissionCounter.js` / `submission-counter.txt` drive unique, rotating test data for the Mortgage Enquiry form so repeated runs don't resubmit identical data.
- The real Google reCAPTCHA v2 form skips its "successful submission" test outright in headless runs (`testInfo.project.use?.headless !== false`), since solving it needs a real headed session.
- `07-pbs.mortgages.spec.js` has 3 tests with a known pre-existing issue on Live (documented in that file's own header) — not a suite bug.
