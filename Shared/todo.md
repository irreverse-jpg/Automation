# Plan: Integrate Automated Tests (Playwright + k6) into TeamCity → Octopus → Server

> Status: **Not started** — captured for later pickup.
> Author: drafted with Claude, 2026-06-12.
> Scope: Wire Hector's QA suites (Playwright functional/E2E/accessibility + k6 load) into the existing
> CI/CD pipeline as a **post-deployment verification + promotion gate**.

---

## 0. Context / current state

- **What exists:** Three client QA suites under `Projects/` — **CareUK**, **PBS**, **Withers**.
  - Each has Playwright specs (`NN-<client>.<area>.spec.js`) including `@axe-core/playwright` accessibility checks.
  - Each has **one k6 load test** (`NN-<client>.load.k6.js`) with `smoke | load | spike | soak | all` scenarios.
  - Each has a `package.json` with `test` + `load:*` scripts and a `playwright.config.js`.
- **What runs today:** GitHub Actions (`.github/workflows/playwright.yml`) on push/PR to `main`, on `ubuntu-latest`.
  Completely disconnected from TeamCity → Octopus.
- **Key properties (good for CI):**
  - k6 has `thresholds` → exits **non-zero** on breach; writes `k6-summary.json` and a readable `handleSummary` verdict.
  - Playwright has CI retries (`retries: 2` when `CI` set) and HTML reporter.
- **Key properties (must fix — see §1):**
  - URL parameterisation is **inconsistent**: Withers = `WITHERS_BASE_URL`, CareUK = `CAREUK_BASE_URL`,
    **PBS = hard-coded** `https://pbs-qa2.hosted.positive.co.uk/` (no env var).
  - No JUnit/CI-consumable reporter on Playwright; k6 emits JSON only.
- **Mental model:** these are **black-box tests against a running URL** (uat/qa/live). They are **not** .NET unit
  tests and must run **after deploy**, not inside the `dotnet build`.

---

## Acceptance criteria (Definition of Done)

- [ ] A deploy to UAT/QA automatically runs smoke (Playwright critical + k6 smoke) against the deployed URL.
- [ ] A failing test gate **blocks promotion to Production** in Octopus.
- [ ] Production deploys run **smoke only** (never load/spike/soak).
- [ ] Test results (pass/fail per test) are visible in TeamCity and/or Octopus, with artifacts (HTML report, traces, `k6-summary.json`).
- [ ] `BASE_URL` is driven by a single env var per environment; no hard-coded URLs remain.
- [ ] One client (Withers) is fully wired as the working template; CareUK + PBS follow the same pattern.

---

## Target architecture

```
TeamCity (build .NET, unit tests, push package to Octopus)
   │
   └─► Octopus: Deploy site to UAT ──► Octopus: post-deploy test step(s)
                                          │  BASE_URL = #{Tests.BaseUrl}  (environment-scoped)
                                          │  1. Playwright smoke (critical specs)   ┐ gate
                                          │  2. k6 smoke (SCENARIO=smoke)            ┘
                                          │  3. k6 load/spike/soak  (UAT/QA ONLY)
                                          ▼
                                pass? ──► promote to PROD ──► PROD smoke only (no load)
                                fail? ──► block promotion + notify
```

**Why Octopus orchestrates the tests:** it already owns the environment and its URL. Make `BASE_URL` an
**environment-scoped Octopus variable**, and the same step works on every environment. A non-zero exit from
Playwright/k6 fails the step → the Octopus lifecycle blocks promotion to Prod = the gate, for free.

**Why keep TeamCity in the loop:** TeamCity is better at test history/trends and build chains. Option to run the
test step as a TeamCity build config triggered after the Octopus deploy completes (see §5, Option B) if we want
richer reporting/history there instead of (or alongside) Octopus.

**Hard rule:** `load | spike | soak` run **only against UAT/QA**. Production gets **smoke only**. Never point a
spike test at live.

---

## Workstreams / task breakdown

### 1. Repo hygiene — make the suites CI-drivable (do this first)
- [ ] **Standardise the URL variable.** Have every client honour a single `BASE_URL` (keep the client-specific
      var as a fallback for local dev). k6 already does `__ENV.BASE_URL || __ENV.<CLIENT>_BASE_URL`.
  - [ ] Withers `playwright.config.js`: `baseURL: process.env.BASE_URL || process.env.WITHERS_BASE_URL || '<uat default>'`
  - [ ] CareUK `playwright.config.js`: same pattern with `CAREUK_BASE_URL` fallback.
  - [ ] **PBS `playwright.config.js`: remove the hard-coded URL**, switch to `process.env.BASE_URL || process.env.PBS_BASE_URL || '<qa default>'`.
- [ ] **Add a JUnit reporter to Playwright** so TeamCity/Octopus show per-test pass/fail + history:
      `reporter: [['html'], ['junit', { outputFile: 'results/junit.xml' }]]`.
- [ ] **Emit JUnit from k6** too (via `handleSummary` writing `results/k6-junit.xml`, or a known k6 junit helper),
      so the load gate reports the same way. Keep the existing `k6-summary.json` + non-zero exit.
- [ ] **Tag a `@smoke` subset** of Playwright specs (critical paths: homepage, meganav, search, forms) so the
      prod gate runs fast and minimal — `npx playwright test --grep @smoke`.
- [ ] **Pin tool versions** for reproducibility: pin k6 version, Playwright already pinned (`@playwright/test ^1.52.0` → consider exact pin).
- [ ] **Add npm scripts** for the CI entry points, e.g. `test:smoke`, `test:ci`, plus existing `load:*`.

### 2. Decide repo/packaging strategy
- [ ] **Recommended:** keep the **single QA repo** (current per-client folder structure). Add it as one VCS root /
      one Octopus package; point each client's Octopus project at the right folder.
- [ ] Alternative (not recommended now): submodule the tests into each client's app repo for tighter version
      alignment — more maintenance, submodule friction. Revisit only if QA and app must version lockstep.

### 3. Build the test runner image / worker
- [ ] Provide a runner with **Node 20 + Playwright browsers + k6**. Easiest = Docker:
      `mcr.microsoft.com/playwright:v1.52.0` (matches their pinned Playwright) + install k6, **or** layer
      `grafana/k6` for the load step.
- [ ] If using a Windows TeamCity agent / Octopus worker instead: install Node 20, `npx playwright install --with-deps`,
      and k6 (winget/choco). Keep OS consistent with what GH Actions uses (currently `ubuntu-latest`).
- [ ] Decide: dedicated **Octopus worker pool** ("QA") vs. ephemeral container per run.

### 4. Octopus wiring (primary integration)
- [ ] Add **environment-scoped variable** `Tests.BaseUrl` per environment (UAT/QA/Prod) in the Octopus project (or a
      Library Variable Set shared across client projects).
- [ ] Get the test code onto the worker: package the QA repo as a deployable artifact **or** `git clone` at run time.
- [ ] Add post-deploy **"Run a Script"** steps (or the k6 / Playwright community step templates), after the deploy steps:
  - [ ] Step A — **smoke gate** (all environments): `npm ci` → `npx playwright test --grep @smoke` → `k6 run --env SCENARIO=smoke <client>.load.k6.js`. Pass/fail gates the deploy.
  - [ ] Step B — **load/perf** (scope to UAT/QA only): `k6 run --env SCENARIO=load …` (and optionally spike/soak).
- [ ] Set `BASE_URL=#{Tests.BaseUrl}` (and `CI=true`) for the steps.
- [ ] Publish artifacts: Playwright `playwright-report/` + `results/junit.xml`, k6 `k6-summary.json` + `results/k6-junit.xml`.
- [ ] Configure the **lifecycle** so promotion UAT → Prod requires the test step to have passed.
- [ ] Consider moving heavy load tests into an **Octopus Runbook** (re-runnable + schedulable) rather than the deploy
      process, so a nightly load run is decoupled from releases.

### 5. TeamCity wiring (choose A or B)
- [ ] **Option A (lean): Octopus owns tests.** TeamCity just builds + creates/deploys the Octopus release
      (`octo create-release` / Octopus Deploy TeamCity plugin). Tests live entirely in Octopus (§4). Simplest.
- [ ] **Option B (richer reporting): TeamCity post-deploy build config.** Add a build chain:
      `Build → Deploy via Octopus (wait for completion) → Run smoke/load tests → import JUnit`.
      TeamCity then owns test history/flaky detection. Use `deploy-release --waitfordeployment` or the plugin's
      "wait for deployment" so the test step runs against the freshly deployed env.
- [ ] Whichever: import the JUnit XML so TeamCity surfaces per-test results.

### 6. Keep GitHub Actions (complementary, not redundant)
- [ ] Leave `playwright.yml` in place: it validates the **test code itself** on PRs (fast feedback when Hector edits
      a spec). TeamCity/Octopus runs the suite as a **release gate** against real deployed environments.
- [ ] Optionally update GH Actions to also produce JUnit + upload k6 summary for consistency.

### 7. Verification (prove the gate works)
- [ ] Deploy to UAT with a **deliberately broken** smoke assertion → confirm the deploy step fails and Prod promotion is blocked.
- [ ] Confirm a **passing** UAT run promotes cleanly and Prod runs smoke-only.
- [ ] Confirm artifacts (HTML report, traces, `k6-summary.json`) are retrievable from Octopus/TeamCity.
- [ ] Confirm load/spike/soak **cannot** run against Prod (scoping check).

### 8. Rollout
- [ ] Implement the full pattern for **Withers** first (template).
- [ ] Roll out to **CareUK** and **PBS** (PBS also needs the hard-coded-URL fix from §1).

---

## Obvious enhancements (backlog — note now, not blocking)

> Quick research only; flagged for later prioritisation.

- **Performance trend storage.** Pipe k6 output to a time-series backend for trends (not just pass/fail) — e.g.
  `k6 run --out influxdb=…` or **Prometheus remote-write** → **Grafana** dashboards. Or use **Grafana Cloud k6**
  (hosted, distributed load generation, historical comparison) if budget allows.
- **Synthetic uptime monitoring.** Schedule the smoke suite against **Prod** on a cron (Octopus Runbook scheduled
  trigger, or GH Actions `schedule:`) as lightweight uptime/canary monitoring between releases.
- **Failure notifications.** Octopus/TeamCity → **Slack/Teams** webhook on gate failure, with a link to the report.
- **Performance budgets / regression gates.** Add **Lighthouse CI** (perf/SEO/PWA/accessibility budgets) as a
  complementary gate to k6 (load) + axe (a11y). Store p95 baselines and alert on regression vs. baseline.
- **Visual regression.** Playwright `toHaveScreenshot()` snapshots for key templates (homepage, meganav, footer).
- **Better failure diagnostics.** Set Playwright `trace: 'retain-on-failure'` + `video: 'retain-on-failure'` in CI and
  upload as artifacts (currently `trace: 'on-first-retry'`).
- **Parallelism/speed.** Playwright sharding across workers (`--shard`) to cut wall-clock on the bigger suites;
  currently `workers: 1` under CI.
- **Secrets handling.** If any journey needs auth (forms, member areas), use **Octopus sensitive variables** /
  TeamCity secure params — never hard-code creds in specs.
- **Cross-browser coverage.** Config currently runs chromium across desktop/tablet/mobile; consider adding
  WebKit/Firefox projects for the smoke set if the clients require it.
- **Shared config/dedupe.** The three clients duplicate `playwright.config.js` + scripts; extract a shared base
  config to reduce drift as the suite grows.

---

## Open decisions for pickup
1. **Octopus-only (5A) vs. TeamCity-reported (5B)?** Recommendation: start 5A (simplest), add 5B if we want test history in TeamCity.
2. **Runner: Docker image vs. dedicated Windows worker?** Recommendation: Docker (`mcr.microsoft.com/playwright` + k6) for reproducibility.
3. **Load tests: deploy step vs. Runbook + nightly schedule?** Recommendation: smoke in the deploy gate; load/spike/soak as a scheduled Runbook on UAT.

---

## First slice when we pick this up
Wire **Withers** end-to-end as the template:
1. §1 repo hygiene for Withers (single `BASE_URL`, JUnit reporters, `@smoke` tags).
2. §4 Octopus smoke gate against UAT + lifecycle gate to Prod.
3. §7 verification (break a smoke test, confirm promotion is blocked).
Then replicate for CareUK and PBS (PBS: also remove hard-coded URL).
