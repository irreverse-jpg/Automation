# CareUK automation suite

QA automation for Care UK (careuk.com), built to match the MCC/Withers/PBS Playwright + k6 structure so it can live independently in the same multi-root workspace.

## What's covered

- `01-careuk.homepage.spec.js` — Homepage
- `02-careuk.meganav.spec.js` — Main menu (meganav)
- `03-careuk.footer.spec.js` — Footer
- `04-careuk.careers.spec.js` — Careers
- `05-careuk.carehomes.spec.js` — Homepage "Types of Care We Offer" carousel
- `06-careuk.customers.spec.js` — Customers
- `07-careuk.carehomessearch.spec.js` — Care homes search
- `08-careuk.wheredoistart.spec.js` — Where Do I Start
- `09-careuk.lifeatacareukhome.spec.js` — Life at a Care UK Home
- `10-careuk.typesofcare.spec.js` — Types of Care
- `11-careuk.ourapproachtocare.spec.js` — Our Approach to Care
- `12-careuk.whoweare.spec.js` — Who We Are
- `13-careuk.helpandadvice.spec.js` — Help & Advice
- `14-careuk.news.spec.js` — Care UK News
- `16-careuk.nonfunctional.spec.js` — SEO / security / accessibility
- `15-careuk.load.k6.js` — k6 load test scaffold

Every spec file's own header comment (a "Coverage notes" box right below the imports) lists its exact test list and any confirmed defects/environment differences — read that first before changing a file.

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke -- --env BASE_URL=https://www.careuk.com`

## Environment

The default environment is controlled from [playwright.config.js](playwright.config.js) via `DEFAULT_BASE_URL`.

Current default:

- `https://uat2.careuk.com`

When you want the project to point somewhere else by default, change that one value in [playwright.config.js](playwright.config.js).

For one-off terminal runs, `CAREUK_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:CAREUK_BASE_URL = 'https://www.careuk.com'
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
  - **Which page/feature** — the site area it belongs to (e.g. Careers, Who We Are, Footer)
  - **Why it's an issue** — a plain-English description, without test/code jargon

Passing tests aren't listed row-by-row - they're just counted in the Summary sheet. This is powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a small `test.afterEach` hook at the top of every spec file, which records the page address whenever a test fails. Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.

## Notes

- `submissionCounter.js` / `submission-counter.txt` drive unique, rotating test data for the reCAPTCHA-gated forms (Customers, Where Do I Start, Our Approach to Care) so repeated runs don't resubmit identical data.
- Real Google reCAPTCHA v2 forms skip their "successful submission" test outright in headless runs (`testInfo.project.use?.headless !== false`), since solving it needs a real headed session.
