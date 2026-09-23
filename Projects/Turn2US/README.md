# Turn2us automation suite

QA automation for Turn2us (turn2us.org.uk), built to match the PBS/Withers/CareUK/MCC/RSC/NPL/TFS Playwright + k6 structure so it can live independently in the same multi-root workspace.

## Environments

- **Staging** (default, most spec-building work happens here): `https://staging.turn2us.org.uk/`
- **UAT**: `https://t2u-uat.hosted.positive.co.uk/`
- **Live**: `https://www.turn2us.org.uk/`

Live carries some extra content and a few differently-named menu options versus Staging - as each spec's coverage is built out, naming/content differences are reconciled against Live rather than assumed upfront.

## What's covered

- `01-turn2us.homepage.spec.js` — Homepage (built out: title, hero heading, scroll behaviour, top-level nav presence + hrefs (desktop and mobile hamburger), skip links)
- `02-turn2us.meganav.spec.js` — Main menu (meganav) — built out (meganav presence, header logo, expand each root item, navigate every second-level link). Only 2 levels deep on this site (no third level), unlike most other client projects.
- `03-turn2us.footer.spec.js` — Footer (built out: footer presence, all 14 footer links, social links). No separate "Legal Links" test - unlike most other projects, Turn2us's legal links (Cookie/Privacy/Terms/Accessibility) aren't in their own footer column, so they're covered by "Footer - Verify Links" like every other footer link.
- `04-turn2us.search.spec.js` — Site search (built out: Empty Query, With and Without Results, Pagination of Results, Clear Search and Second Search). No sort-by test - unlike most other projects, Turn2us has no sort options, so the 4th test instead covers the results page's own separate search box and its "Clear search" behaviour.
- `05-turn2us.nonfunctional.spec.js` — SEO / security / accessibility (homepage only for now)
- `06-turn2us.load.k6.js` — k6 load test scaffold (homepage + robots.txt/sitemap.xml only for now)

Every spec file's own header comment (a "Coverage notes" box right below the imports) lists its exact test list and any confirmed defects/environment differences — read that first before changing a file.

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke -- --env BASE_URL=https://staging.turn2us.org.uk`

## Environment override

The default environment is controlled from [playwright.config.js](playwright.config.js) via `DEFAULT_BASE_URL` (currently Staging).

For one-off terminal runs, `TURN2US_BASE_URL` still overrides the config default:

```powershell
$env:TURN2US_BASE_URL = 'https://www.turn2us.org.uk'
npx playwright test
```

## Findings report (for sharing with the team)

Every test run automatically produces a plain-language findings spreadsheet, in addition to the usual Playwright HTML report:

- `findings-report.xlsx` — open in Excel (or Google Sheets/Numbers), share the file directly (e.g. email/Teams/Slack attachment)
- `findings-reports/` — a timestamped copy is kept here after every run, so past runs aren't overwritten

The workbook has three sheets:

- **Summary** — checks run, passed, and how many findings need review
- **Findings** — one row per failing/needs-attention test, filterable/sortable
- **All Tests** — the complete list of every check run, passed or failed

Both the report output and its archive folder are gitignored — they're regenerated per run, not checked in.

## Notes

- `submissionCounter.js` / `submission-counter.txt` are ready for whichever future form-submission spec needs unique, rotating test data (no submission specs exist yet).
- Turn2us uses **Cookiebot** for cookie consent (not OneTrust, which most other client projects in this workspace use) - confirmed via direct probing 2026-09-23. Dialog id `#CybotCookiebotDialog`, "Allow all cookies" button id `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`.
- "Meganav - Navigate to Second Level" walks every real second-level link (~28 across 5 root items) with a fresh homepage reload before each one, matching the exhaustive tree-walk convention used elsewhere in this workspace. Normal runtime is ~5 minutes; one run on 2026-09-23 took ~51 minutes while Staging was confirmed running unusually slow that moment (a real environment condition, not a test issue - a re-run once Staging recovered came back to ~5 minutes). Its `test.setTimeout` is set to 60 minutes to leave margin above even that slow outlier.
- Registered in `Projects/automation-tests.code-workspace` so it shows up in VS Code's Explorer and Test Explorer.
