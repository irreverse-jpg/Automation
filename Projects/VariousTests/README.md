# VariousTests

Sandbox project for one-off Playwright tasks that aren't part of any client suite
(PBS, Withers, CareUK, MCC, RSC). Use this when you need to spin up a quick test,
run it, look at the result, then throw it away.

## Workflow

1. Ask for a new spec, e.g. `01-james-walker-form.spec.js`. Numbering is not
   sequential/permanent like the client projects — just enough to keep files
   sorted while they exist.
2. Set `baseURL` for the task, either directly in `playwright.config.js` or
   inline in the spec via `page.goto('https://full-url/...')`.
3. Run it: `npm test`, `npm run test:headed`, or `npm run test:ui`.
4. Once you're done with the task, delete the spec file(s). The project
   scaffold (config, package.json) stays — only the task-specific spec goes.

## Notes

- No k6 load testing, no CI workflow, no nonfunctional/accessibility spec here
  by default — those belong to the client-project scaffold. Add them ad hoc
  only if a specific task needs them.
- `npm install` once after cloning/creating, same as any other project here.
