# MCC automation suite

QA automation for Lord's Cricket Ground / MCC (lords.org), scaffolded to match the CareUK/Withers/PBS Playwright + k6 structure so it can live independently in the same multi-root workspace.

## Included baseline

- Independent `package.json` and `node_modules`
- Local `playwright.config.js`
- CI workflow under `.github/workflows/playwright.yml`
- `01-mcc.homepage.spec.js` fully built out (homepage load, scrolling, eyebrow navigation, quick links navigation)
- Starter (skipped) spec files `02` through `09` covering meganav, footer, search, match day, experiences, careers, MCC club/membership, and non-functional/accessibility — each lists candidate paths discovered on the live site to speed up building real coverage
- Full k6 load test scaffold (`10-mcc.load.k6.js`)
- Local submission counter helper for future successful form-submission tests

## Commands

- Install dependencies: `npm install`
- List discovered tests: `npx playwright test --list`
- Run all Playwright tests: `npm test`
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run non-functional starter file only: `npm run test:nonfunctional`
- Run k6 smoke profile: `npm run load:smoke -- --env BASE_URL=https://lords-uat2.hosted.positive.co.uk`

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

## Notes

- Spec files `02`-`09` are intentionally skipped placeholders so the project is discoverable in Test Explorer without failing immediately. Each file's header comment lists real paths found on the live site to build real coverage from.
- `submissionCounter.js` is ready if you later add successful form-submission tests that need unique datasets.
