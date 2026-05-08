# Copilot instructions for this repository

## Project scope
- This repo is an end-to-end QA suite for the Principality website using Playwright plus a separate k6 load test.
- Main test inventory is flat and numbered by area (`01-...` to `09-...`) in the workspace root.
- `09-pbs.nonfunctional.spec.js` covers SEO/security/accessibility checks (including axe).
- `10-pbs.load.k6.js` is performance/load validation and writes `k6-summary.json`.

## Architecture and data flow
- UI tests use Playwright `page` flows with relative paths (`page.goto('/...')`) resolved by `use.baseURL` in `playwright.config.js`.
- Several specs also use Playwright `request` for direct HTTP assertions (sitemaps, headers, link checks).
- Load tests are intentionally separate from Playwright and must be run via k6 with `BASE_URL` env.
- CI executes Playwright only (`.github/workflows/playwright.yml`), Node 20, HTML report artifact upload.

## Execution workflows
- Install deps: `npm ci`
- Run full Playwright suite: `npm test` (same as `npx playwright test`)
- Run headed: `npm run test:headed`
- Run UI mode: `npm run test:ui`
- Run a single file while iterating: `npx playwright test 08-pbs.savings.spec.js`
- Run load test: `k6 run --env BASE_URL=https://pbs-qa2.hosted.positive.co.uk 10-pbs.load.k6.js`
- Select k6 profile: add `--env SCENARIO=smoke|load|spike|soak|all`

## Code conventions specific to this suite
- Playwright specs use CommonJS (`require`); k6 script uses ESM (`import`). Do not mix module styles.
- Keep helper functions local to each spec unless there is a clear reuse case (current style duplicates small helpers intentionally).
- Cookie handling pattern is expected in most specs via `acceptCookiesIfPresent()` and shared selector variants.
- Tests usually call `page.waitForLoadState('load')` after initial navigation before assertions/actions.
- For responsive nav/filter UIs, guard interactions with conditional openers (`Open menu`, `#filters-opener`, `#show-results`).
- Prefer resilient role/text/regex locators and `expect.poll` for async UI state changes.

## Environment-specific behavior
- `playwright.config.js` contains a manually switched `baseURL` (QA/QA2/UAT2/Live notes are in-file).
- Some assertions branch by environment content differences (example: homepage ISA CTA path in `01-pbs.homepage.spec.js`).
- URL assertions often use `${baseURL}...`; preserve this pattern when adding navigation checks.

## High-risk tests and side effects
- Form success flow in `05-pbs.forms.spec.js` is intentionally `test.skip` (reCAPTCHA/manual gate and side effects).
- Submission sequencing uses `submissionCounter.js` + `submission-counter.txt`; avoid enabling mutating submission tests in normal CI runs.
- Footer link checks accept 2xx/3xx and use HEAD with GET fallback to handle environment redirects/walls.

## When adding/updating tests
- Keep file naming and test-title prefix style aligned with existing areas (e.g., `Savings Accounts - ...`, `Non-Functional - ...`).
- If touching sorting/filter tests, preserve “visual order” extraction helpers (DOM text parsing + positional sorting) used in mortgages/savings specs.
- Keep default timeouts modest; only extend per test (`test.setTimeout`) when endpoint behavior is known to be slow.
