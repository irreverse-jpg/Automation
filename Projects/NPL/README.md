# NPL automation suite

QA automation for the National Physical Laboratory (npl.co.uk), built to match the PBS/Withers/CareUK/MCC/RSC Playwright + k6 structure so it can live independently in the same multi-root workspace.

## What's covered

- `01-npl.homepage.spec.js` — Homepage
- `02-npl.meganav.spec.js` — Main menu (meganav)
- `03-npl.footer.spec.js` — Footer
- `04-npl.search.spec.js` — Site search
- `05-npl.research-and-science.spec.js` — Full traversal of every "Research and science" meganav sub-item, with per-page checks (title, landmarks, exactly one H1)
- `06-npl.products-and-services.spec.js` — Full traversal of every "Products and services" meganav sub-item, with per-page checks (title, landmarks, exactly one H1)
- `07-npl.nonfunctional.spec.js` — SEO / security / accessibility
- `08-npl.load.k6.js` — k6 load test scaffold

Every spec file's own header comment (a "Coverage notes" box right below the imports) lists its exact test list and any confirmed defects/environment differences — read that first before changing a file.

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke`

## Environment

The default environment is controlled from [playwright.config.js](playwright.config.js) via the `baseURL` value.

Current default:

- `https://npl-uat-kx13.hosted.positive.co.uk` (UAT)

Test cases were built against Live (`https://www.npl.co.uk`) content, since that's where the real site structure/copy was confirmed, but the suite runs against UAT by default — matching the convention used by the other client projects.

When you want the project to point somewhere else by default, change that one value in [playwright.config.js](playwright.config.js).

For one-off terminal runs, `NPL_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:NPL_BASE_URL = 'https://www.npl.co.uk'
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
  - **Which page/feature** — the site area it belongs to (e.g. Meganav, Footer, Search)
  - **Why it's an issue** — a plain-English description, without test/code jargon

Passing tests aren't listed row-by-row - they're just counted in the Summary sheet. This is powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a small `test.afterEach` hook at the top of every spec file, which records the page address whenever a test fails. Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.
