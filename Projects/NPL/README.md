# NPL automation suite

QA automation for the National Physical Laboratory (npl.co.uk), built to match the PBS/Withers/CareUK/MCC/RSC Playwright + k6 structure so it can live independently in the same multi-root workspace.

## What's covered

- `01-npl.homepage.spec.js` — Homepage
- `02-npl.meganav.spec.js` — Main menu (meganav)
- `03-npl.footer.spec.js` — Footer: deep per-page checks on every legal/utility link, existence+destination checks on the social row, and the "Share your feedback" form's 3-journey coverage (empty, invalid email, successful submission)
- `04-npl.search.spec.js` — Site search
- `05-npl.research-and-science.spec.js` — Full traversal of every "Research and science" meganav sub-item, with per-page checks (title, landmarks, exactly one H1)
- `06-npl.products-and-services.spec.js` — Full traversal of every "Products and services" meganav sub-item, with per-page checks (title, landmarks, exactly one H1)
- `07-npl.strategic-programmes.spec.js` — Full traversal of every "Strategic programmes" meganav sub-item, with per-page checks (title, landmarks, exactly one H1)
- `08-npl.education-and-learning.spec.js` — Full traversal of every "Education and learning" meganav sub-item, with deep per-page checks (title, meta description, canonical, favicon, landmarks, exactly one H1, no broken images, sampled main-content link health, no console errors)
- `09-npl.news-and-events.spec.js` — Full traversal of every "News and events" meganav sub-item, with the same deep per-page checks as 08
- `10-npl.about-npl.spec.js` — Full traversal of every "About NPL" meganav sub-item (the largest section, 23 links), with the same deep per-page checks as 08 plus a dedicated "not a 404 page" check
- `11-npl.nonfunctional.spec.js` — SEO / security / accessibility
- `12-npl.load.k6.js` — k6 load test scaffold

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

The workbook has three sheets:

- **Summary** — checks run, passed, and how many findings need review
- **Findings** — one row per failing/needs-attention test, filterable/sortable, with columns for:
  - **Where (page address)** — the exact page the issue was seen on (clickable link)
  - **Which page/feature** — the site area it belongs to (e.g. Meganav, Footer, Search)
  - **Why it's an issue** — a plain-English description, without test/code jargon
- **All Tests** — every check run this session, passed or failed, with the same columns plus a Result column

This is powered by `reporters/findings-reporter.js` (configured in `playwright.config.js`) plus a small `test.afterEach` hook at the top of every spec file, which records the page address whenever a test fails. Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.

## Notes

- `submissionCounter.js` / `submission-counter.txt` drive unique, rotating test data for the "Share your feedback" form so repeated runs don't resubmit identical data. This file IS committed (not gitignored) so the counter persists across machines/CI runs.
- The feedback form's real Google reCAPTCHA v2 means its "Validate Successful Submission" test skips outright in headless runs (`testInfo.project.use?.headless !== false`) - solving it needs a real headed session with a human present. Run `npm run test:headed` and solve the CAPTCHA manually when it appears; the test resumes automatically once the token is populated (up to a 5-minute wait).
- The "Share your feedback" link/form only exists on UAT as of 2026-07-30 - it's not present in Live's footer at all.
