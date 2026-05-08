# QA Automation Workspace

This workspace contains shared documentation plus two Playwright-based project suites.

## Start here (new team members)

1. Open `Projects/automation-tests.code-workspace` in VS Code.
2. Pick one project to begin with (`Projects/PBS` or `Projects/Withers`).
3. Run tests from that project folder (`npm test`).
4. For creating a new suite, follow `Shared/docs/new-project-checklist.md`.

## 30-minute quick start

1. Open `Projects/automation-tests.code-workspace` in VS Code.
2. Open a terminal in either `Projects/PBS` or `Projects/Withers`.
3. Install dependencies: `npm install`.
4. Run the suite: `npm test`.
5. If needed, run headed mode for debugging: `npm run test:headed`.
6. Review generated artifacts in the project's `playwright-report/` and `test-results/` folders.

If tests fail on first run, verify:

- Node.js is installed (LTS recommended).
- Browsers are available: `npx playwright install`.
- If you see `browserType.launch: Executable doesn't exist`, run `npx playwright install chromium`.
- The configured base URL in `playwright.config.js` is reachable from your network.

## Current folder layout

- `Projects/PBS` -> PBS automation suite
- `Projects/Withers` -> Withers automation suite
- `Projects/automation-tests.code-workspace` -> multi-root VS Code workspace file
- `Shared/docs` -> shared standards and onboarding notes

## Day-to-day usage

1. Work inside one project folder at a time (`Projects/PBS` or `Projects/Withers`).
2. Run tests from the active project folder (`npm test`).
3. Keep project patterns aligned for easy cross-team support.

## Reporting artifacts and cleanup

- `playwright-report/` and `test-results/` are generated outputs.
- Keep these inside each project when needed for debugging.
- Root-level generated report folders under `Projects/` can be removed.
- Project README files are optional and may be removed if not used by the team.

## Documentation map

- `Shared/README.md` -> onboarding and workspace orientation
- `Shared/docs/new-project-checklist.md` -> step-by-step setup checklist for new suites
- For missing Run/Debug buttons or missing projects in Test Explorer, see section "8) VS Code Test Explorer troubleshooting (Playwright)" in `Shared/docs/new-project-checklist.md`.

## Cross-project consistency

Keep patterns aligned across projects:

- same spec naming convention (`01-...` to `10-...`)
- similar Playwright config shape
- same CI workflow baseline
