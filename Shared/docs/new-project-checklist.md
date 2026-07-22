# New project checklist

Use this checklist each time you create a new automation suite.
For workspace orientation and onboarding context, read `Shared/README.md` first.

## Preferred creation method

- Create the project manually under `Projects/`.
- Follow the same baseline shape used by `Projects/PBS` and `Projects/Withers`.

## 1) Create project folder

- `Projects/<ProjectName>`

## 2) Baseline files

- `package.json`
- `playwright.config.js`
- `.gitignore`
- `.github/workflows/playwright.yml`
- `README.md` (optional)
- `01-<project>.homepage.spec.js`, `02-<project>.meganav.spec.js`, `03-<project>.footer.spec.js`, `04-<project>.search.spec.js` — scaffold these 4 by default for every new project. Across PBS/Withers/MCC these same 4 areas always end up as the first 4 specs (numbering order can vary slightly per project - match whatever the new site's actual structure calls for), so start with them rather than waiting to be asked. CareUK is the one exception on record (its "search" is folded into a care-homes-specific spec instead of a generic sitewide search) - use judgement if the new site doesn't have an equivalent generic search feature.
- Further `NN-...` specs for whatever other site sections/features exist, added as they're built out.
- `NN-...nonfunctional.spec.js` and `NN-...load.k6.js` — scaffold both by default alongside the 4 specs above, not just when explicitly requested. Number them after the last content spec (see section 9 for the load file's own conventions).
- `reporters/findings-reporter.js` (see section 8 below)

Before marking this section complete, verify the new project can run `npm test` locally.

## 2a) Register the project in the multi-root workspace file

- Add `{ "name": "<ProjectName>", "path": "<ProjectName>" }` to the `folders` array in `Projects/automation-tests.code-workspace`.
- This is a *separate* file from the root `Automation.code-workspace` (which just points at the whole `Projects` directory as one root and needs no edit). `automation-tests.code-workspace` is the one actually opened day-to-day, and it hardcodes each client as its own named folder root.
- Skipping this step is easy to miss and has a specific, confusing symptom: the new project's files, Explorer entry, and Test Explorer entries are all invisible in VS Code even though the project itself is fully valid and `npx playwright test --list` finds its tests fine from the terminal. Don't waste time checking OneDrive sync state or the Playwright extension's config toggle first — check this file first.

## 3) Naming conventions

- Spec names: `01-<project>.homepage.spec.js`, etc.
- Keep one domain/area per spec file.
- Keep tests deterministic and environment-safe.

## 4) Environment and secrets

- Use environment variables for base URLs and sensitive config.
- Never commit secrets.
- Add `.env.example` only when the project needs local env setup documentation.

## 5) CI

- Reuse standard workflow with Node LTS and Playwright browser install.

## 6) Reuse strategy

- Copy successful patterns from existing projects.
- Keep selectors robust (`getByRole`, visible locators, explicit assertions).
- Keep shared logic lightweight unless a clear reuse case appears.
- If reuse grows across many projects, extract a shared internal package later.

## 7) Generated artifacts and cleanup

- `playwright-report/` and `test-results/` are generated outputs.
- Keep generated outputs inside each project only when needed for debugging.
- Remove root-level generated report folders from `Projects/` when they appear.

## 8) Findings report (team-facing, non-technical)

Every current project (MCC, PBS, Withers, CareUK) produces a plain-language findings spreadsheet after each test run, in addition to the standard Playwright HTML report, so results can be shared with non-technical teammates. Set this up for every new project:

- Add `exceljs` as a devDependency: `npm install --save-dev exceljs`.
- Copy `reporters/findings-reporter.js` from an existing project (e.g. `Projects/MCC/reporters/findings-reporter.js`) and update its `FRIENDLY_FILE_NAMES` map to the new project's own spec files, plus the `HEADER_TITLE`/`creator` strings.
- Register it in `playwright.config.js`: `reporter: [['html'], ['./reporters/findings-reporter.js']]`.
- Add a small `test.afterEach` hook to the top of every spec file (right after the `require('@playwright/test')` line) that attaches a `failure-context` JSON blob (`url`, `pageTitle`, `environment`, `viewport`) on failure — copy this verbatim from any existing project's spec file, since each project keeps it self-contained per file rather than importing it from a shared module.
- Add `findings-report.xlsx` and `findings-reports/` to `.gitignore` — these are regenerated per run, not checked in.
- Keep using a human-readable message as the 2nd argument to every `expect()` call (already the convention across all 4 projects) — the reporter surfaces that message as the finding's "why," so there's no separate explanation to maintain.

## 9) k6 load test quick guide

Every current project's k6 load test file (`Projects/PBS/10-pbs.load.k6.js`, `Projects/Withers/14-withers.load.k6.js`, `Projects/MCC/14-mcc.load.k6.js`, `Projects/CareUK/15-careuk.load.k6.js`) follows the same structure so anyone - not just the person who wrote it - can run and read the results. Set this up for every new project's k6 file:

- Copy an existing project's `*.load.k6.js` wholesale as the starting point (they're all functionally identical apart from the base URL, page paths, and env var names) rather than writing one from scratch.
- Keep the `QUICK GUIDE` block comment near the top - what the file does, the 5 scenarios (`smoke`/`load`/`spike`/`soak`/`all`), copy-pasteable `k6 run` commands for both "from the Projects folder" and "from this project's own folder", the exact list of pages the script exercises, and a "how to read results fast" section.
- Update the page list in both the `QUICK GUIDE` comment and the `browseCorePages()` function to the new project's own real, confirmed page paths - verify each path actually resolves (e.g. `grep` existing spec files' `goto()`/`route:` calls for already-confirmed real paths, or check directly) rather than guessing plausible-looking URLs.
- Keep the richer `handleSummary()` (Final verdict, Gate result per threshold, main health metrics, failing checks list) - it's what makes a FAIL immediately actionable instead of just a wall of raw k6 metrics.
- Keep the `BASE_URL || <PROJECT>_BASE_URL || K6_BASE_URL` env var fallback chain and the `ORIGIN`-based root-level `/robots.txt`/`/sitemap.xml` checks.
- Update `package.json`'s `load:smoke`/`load:load`/`load:spike`/`load:soak`/`load:all` scripts to reference the new file's exact name.

## 10) VS Code Test Explorer troubleshooting (Playwright)

Use this section when test Run/Debug buttons are missing, or when one workspace folder appears but another does not.

### Symptoms

- No Run/Debug play buttons above test blocks.
- Empty Test Explorer.
- Only a subset of projects is visible in a multi-root workspace.

### Verify from terminal first

- In each project folder, run: npx playwright test --list
- If tests are listed, discovery works and the issue is usually VS Code UI state or filters.

### Required VS Code settings

Set these in workspace or folder settings:

- editor.codeLens = true
- testing.gutterEnabled = true
- testing.defaultGutterClickAction = run
- testing.automaticallyOpenPeekView = never

### Recovery steps in VS Code

1. Open Command Palette with F1 (or View -> Command Palette).
2. If commands do not appear, type > first in the command box.
3. Run Test: Toggle Playwright configs.
4. Ensure configs are enabled for all expected projects in the workspace.
5. Open View -> Testing.
6. Clear the Testing search box and disable restrictive filters (failed-only, current-file-only, and similar).
7. Click Refresh Tests in the Testing panel.
8. Expand all roots and verify all expected projects appear.

### If still not visible

1. Confirm the workspace is trusted (not in Restricted Mode).
2. Confirm Playwright Test for VS Code extension is enabled for the workspace.
3. Reload VS Code window using Developer: Reload Window.
4. If needed, close all VS Code windows and reopen the .code-workspace file.

### Multi-root note

When working in a multi-root workspace, the Playwright extension can be scoped to selected configs. If any project is missing in Test Explorer, run Test: Toggle Playwright configs and re-enable the missing project config.
