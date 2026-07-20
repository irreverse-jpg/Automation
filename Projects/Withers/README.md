# Withers automation suite

QA automation for Withers Worldwide (withersworldwide.com), built to match the MCC/CareUK/PBS Playwright + k6 structure so it can live independently in the same multi-root workspace.

## What's covered

- `01-withers.homepage.spec.js` — Homepage
- `02-withers.meganav.spec.js` — Main menu (meganav)
- `03-withers.footer.spec.js` — Footer
- `04-withers.search.spec.js` — Site search
- `05-withers.contact.spec.js` — Contact form
- `06-withers.newsroom.spec.js` — Newsroom
- `07-withers.experience.spec.js` — Experience
- `08-withers.people.spec.js` — People
- `09-withers.locations.spec.js` — Locations
- `10-withers.insight.spec.js` — Insight
- `11-withers.about.spec.js` — About
- `12-withers.careers.spec.js` — Careers
- `13-withers.nonfunctional.spec.js` — SEO / security / accessibility
- `14-withers.load.k6.js` — k6 load test scaffold

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

- `https://w-uat.hosted.positive.co.uk/en-gb`

When you want the project to point somewhere else by default, change that one value in [playwright.config.js](playwright.config.js).

For one-off terminal runs, `WITHERS_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:WITHERS_BASE_URL = 'https://www.withersworldwide.com/en-gb'
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
  - **Which page/feature** — the site area it belongs to (e.g. People, Locations, Footer)
  - **Why it's an issue** — a plain-English description, without test/code jargon

Passing tests aren't listed row-by-row - they're just counted in the Summary sheet. This is powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a small `test.afterEach` hook at the top of every spec file, which records the page address whenever a test fails. Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.

## Notes

- `submissionCounter.js` / `submission-counter.txt` drive unique, rotating test data for the Contact and Careers (Recruitment Enquiries) forms so repeated runs don't resubmit identical data.
- Real Google reCAPTCHA v2 forms skip their "successful submission" test outright in headless runs (`testInfo.project.use?.headless !== false`), since solving it needs a real headed session.
