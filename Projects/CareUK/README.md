# CareUK automation suite

This project is scaffolded to match the current Withers Playwright + k6 structure so it can live independently in the same multi-root workspace.

## Included baseline

- Independent `package.json` and `node_modules`
- Local `playwright.config.js`
- CI workflow under `.github/workflows/playwright.yml`
- Starter numbered spec files from homepage through non-functional coverage
- Starter k6 load test scaffold
- Local submission counter helper for future successful form-submission tests

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional starter file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke -- --env BASE_URL=https://www.careuk.com`

## Environment

The default environment is controlled from [CareUK/playwright.config.js](CareUK/playwright.config.js) via `DEFAULT_BASE_URL`.

Current default:

- `https://uat2.careuk.com`

When you want the project to point somewhere else by default, change that one value in [CareUK/playwright.config.js](CareUK/playwright.config.js).

For one-off terminal runs, `CAREUK_BASE_URL` still overrides the config default.

PowerShell example:

```powershell
$env:CAREUK_BASE_URL = 'https://www.careuk.com'
npx playwright test
```

## Notes

- The starter spec files are intentionally skipped placeholders so the project is discoverable in Test Explorer without failing immediately.
- Replace the placeholder titles and test bodies as you build out real coverage.
- `submissionCounter.js` is ready if you later add successful form-submission tests that need unique datasets.
