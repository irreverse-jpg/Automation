# QA Automation Workspace

This workspace contains shared documentation plus eight Playwright + k6 client suites, one per folder under `Projects/`.

**New here? Read [HANDOVER.md](../HANDOVER.md) at the repo root first.** It covers the state of every project, open items and known gotchas.

## Credits

This QA automation workspace was designed and built by **Hector Ortega, QA Lead**, between May and October 2026. That covers:

- the shared framework and project structure used by every client suite
- the client suites: PBS, Withers, CareUK, MCC, RSC, NPL, TFS and Turn2US
- the custom findings reporter (plain-language `findings-report.xlsx`)
- the k6 load-testing setup, nonfunctional/accessibility checks and QA Test Coverage documentation

## Start here (new team members)

1. Open `Projects/automation-tests.code-workspace` in VS Code.
2. Pick one project to begin with. PBS or Withers are good first choices: public sites, no login needed.
3. Run tests from that project folder (`npm test`).
4. For creating a new suite, follow `Shared/docs/new-project-checklist.md`.

## 30-minute quick start

1. Open `Projects/automation-tests.code-workspace` in VS Code.
2. Open a terminal in a project folder, e.g. `Projects/PBS`.
3. Install dependencies: `npm install`.
4. Run the suite: `npm test`.
5. If needed, run headed mode for debugging: `npm run test:headed`.
6. Review the results: `findings-report.xlsx` in the project folder (plain-language findings), plus `playwright-report/` and `test-results/` for technical detail.

If tests fail on first run, verify:

- Node.js is installed (LTS recommended).
- Browsers are available: `npx playwright install`.
- If you see `browserType.launch: Executable doesn't exist`, run `npx playwright install chromium`.
- The configured base URL in `playwright.config.js` is reachable from your network.
- TFS only: `Projects/TFS/.env` exists with valid portal credentials (copy `.env.example`).

## Current folder layout

- `Projects/<Client>` -> one automation suite per client: PBS, Withers, CareUK, MCC, RSC, NPL, TFS, Turn2US
- `Projects/automation-tests.code-workspace` -> multi-root VS Code workspace file
- `Shared/docs` -> shared standards and onboarding notes
- `Shared/todo.md` -> CI/CD integration plan (TeamCity -> Octopus), not started
- `HANDOVER.md` (repo root) -> current state of every project and how to pick the work up

## Day-to-day usage

1. Work inside one project folder at a time.
2. Run tests from the active project folder (`npm test`). Switch environment with the project's `<CLIENT>_BASE_URL` variable (see each `playwright.config.js`).
3. Never run two environments of the same project at the same time. They share one `test-results/` folder and findings report, and corrupt each other's output.
4. Keep project patterns aligned for easy cross-team support.

## Reporting artifacts and cleanup

- `playwright-report/`, `test-results/` and `findings-report.xlsx` are generated outputs (gitignored).
- `findings-reports/` holds timestamped copies of past findings reports. It is gitignored but is the only record of past runs, so don't delete it.

## Documentation map

- `HANDOVER.md` (repo root) -> state of each project, open items, gotchas
- `Shared/README.md` -> onboarding and workspace orientation
- `Shared/docs/new-project-checklist.md` -> step-by-step setup checklist for new suites
- `Projects/<Client>/README.md` -> per-project file list and notes
- `Projects/<Client>/QA Test Coverage/` -> client-facing coverage overview (.docx)
- For missing Run/Debug buttons or missing projects in Test Explorer, see section "8) VS Code Test Explorer troubleshooting (Playwright)" in `Shared/docs/new-project-checklist.md`.

## Cross-project consistency

Keep patterns aligned across projects:

- same spec naming convention (`NN-<client>.<area>.spec.js`, with nonfunctional and k6 load last)
- similar Playwright config shape
- same findings reporter (`reporters/findings-reporter.js`), with a per-project `FRIENDLY_FILE_NAMES` map
