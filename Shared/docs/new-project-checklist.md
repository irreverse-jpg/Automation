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
- `01-...` to `09-...` initial specs
- `10-...load.k6.js` (if performance testing applies)

Before marking this section complete, verify the new project can run `npm test` locally.

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

## 8) VS Code Test Explorer troubleshooting (Playwright)

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
