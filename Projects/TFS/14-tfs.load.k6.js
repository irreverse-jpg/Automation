import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '');
const SELECTED_SCENARIO = (__ENV.SCENARIO || 'all').trim().toLowerCase();
const TFS_EMAIL = __ENV.TFS_EMAIL || '';
const TFS_PASSWORD = __ENV.TFS_PASSWORD || '';

if (!BASE_URL) {
    throw new Error('BASE_URL is required. Example: BASE_URL=https://tfs-qa.hosted.positive.co.uk');
}
if (!TFS_EMAIL || !TFS_PASSWORD) {
    throw new Error('TFS_EMAIL and TFS_PASSWORD are required (the portal is login-gated - every page in this script needs an authenticated session). Example: --env TFS_EMAIL=... --env TFS_PASSWORD=...');
}

const errorRate = new Rate('errors');
const ttfbTrend = new Trend('ttfb_ms');
const durationTrend = new Trend('duration_ms');

/*
QUICK GUIDE (k6 load tests)
====================================

What this file does
-------------------
- Unlike every other project's k6 file (public GET-only pages), TFS's portal is login-gated - this
  script logs in for real once (via the same JSON API the real login form calls,
  `POST /api/v1/auth/login`), then reuses that one session's cookies for every virtual user's
  requests, mirroring TFS's own confirmed architecture: logging in with these credentials always
  issues the exact same canonical, per-USER session cookie value no matter how many separate
  contexts/browsers/VUs do it (see the README and every Playwright spec's own "shared
  session" notes) - so sharing one login across VUs here isn't a simplification, it's actually how
  the real app already behaves under concurrent access from the same account.
- Measures reliability (failures) and speed (response times) for the portal's main pages.
- Prints a summary at the end with a clear final verdict.
- SECURITY: never logs the request body of the login call or any response body that could contain
  session tokens - only status codes and timing are ever printed. Credentials are read exclusively
  from __ENV (TFS_EMAIL/TFS_PASSWORD), never hardcoded.

Scenarios available
-------------------
- smoke: quick health check (small run)
- load: normal expected traffic pattern
- spike: sudden traffic surge
- soak: longer stability run
- all: runs all scenarios together

How to run (PowerShell)
-----------------------
The script path is relative to your current working directory. Credentials are the same
TFS_EMAIL/TFS_PASSWORD used by the Playwright suite's own .env file.

From the Projects folder (cd .../Projects):
- Smoke:
    k6 run --env BASE_URL=https://tfs-qa.hosted.positive.co.uk --env TFS_EMAIL=... --env TFS_PASSWORD=... --env SCENARIO=smoke TFS/14-tfs.load.k6.js
- Load:
    k6 run --env BASE_URL=https://tfs-qa.hosted.positive.co.uk --env TFS_EMAIL=... --env TFS_PASSWORD=... --env SCENARIO=load TFS/14-tfs.load.k6.js
- Spike:
    k6 run --env BASE_URL=https://tfs-qa.hosted.positive.co.uk --env TFS_EMAIL=... --env TFS_PASSWORD=... --env SCENARIO=spike TFS/14-tfs.load.k6.js
- Soak:
    k6 run --env BASE_URL=https://tfs-qa.hosted.positive.co.uk --env TFS_EMAIL=... --env TFS_PASSWORD=... --env SCENARIO=soak TFS/14-tfs.load.k6.js
- All scenarios:
    k6 run --env BASE_URL=https://tfs-qa.hosted.positive.co.uk --env TFS_EMAIL=... --env TFS_PASSWORD=... TFS/14-tfs.load.k6.js

From the TFS folder (cd .../Projects/TFS), drop the `TFS/` prefix on the script path.

npm script shortcuts (reads TFS_EMAIL/TFS_PASSWORD from your shell environment - set them first,
e.g. from .env via `Get-Content .env` or by exporting them):
- Smoke:  npm run load:smoke
- Load:   npm run load:load
- Spike:  npm run load:spike
- Soak:   npm run load:soak
- All:    npm run load:all

How to read results fast
------------------------
1) Read "Final verdict" first.
     - PASS = all thresholds met
     - FAIL = at least one threshold breached
2) Check "Gate result (thresholds)" to see exactly what failed.
3) Check "Failing checks" to identify the endpoint causing problems.
4) Full raw run data is saved to: k6-summary.json

What smoke specifically means in this script
--------------------------------------------
- 2 virtual users (vus: 2)
- each runs 5 iterations (iterations: 5)
- each iteration executes browsePortalPages()
- browsePortalPages() requests core portal pages + one random extra page
- thresholds decide pass/fail for reliability and latency

What load specifically means in this script
-------------------------------------------
- starts with 1 virtual user (startVUs: 1)
- ramps to 10 users over 2 minutes
- holds 10 users for 5 minutes
- ramps down to 0 users over 2 minutes
- total planned pattern is about 9 minutes (+ graceful ramp-down)
- each active user repeats browsePortalPages() for the full stage pattern

What spike specifically means in this script
--------------------------------------------
- starts near baseline traffic (1 user)
- rapidly spikes to 40 users in 30 seconds
- holds 40 users for 2 minutes
- drops back down to 1 user in 30 seconds
- used to test sudden traffic shock behavior
- each active user repeats browsePortalPages() during the spike profile

What soak specifically means in this script
--------------------------------------------
- runs 5 constant virtual users (vus: 5)
- duration is 10 minutes (continuous)
- used to check stability over time (not just short burst speed)
- each active user continuously repeats browsePortalPages()

What all scenarios means in this script
---------------------------------------
- runs smoke + load + spike + soak together in one run
- final verdict/thresholds are combined for that full run
- for easiest analysis, run scenarios one-by-one first
*/

const ALL_SCENARIOS = {
    smoke: {
        executor: 'per-vu-iterations',
        vus: 2,
        iterations: 5,
        maxDuration: '2m',
        exec: 'browsePortalPages',
    },
    load: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
            { duration: '2m', target: 10 },
            { duration: '5m', target: 10 },
            { duration: '2m', target: 0 },
        ],
        exec: 'browsePortalPages',
        gracefulRampDown: '30s',
    },
    spike: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
            { duration: '30s', target: 1 },
            { duration: '30s', target: 40 },
            { duration: '2m', target: 40 },
            { duration: '30s', target: 1 },
        ],
        exec: 'browsePortalPages',
        gracefulRampDown: '30s',
    },
    soak: {
        executor: 'constant-vus',
        vus: 5,
        duration: '10m',
        exec: 'browsePortalPages',
    },
};

const scenarios = SELECTED_SCENARIO === 'all'
    ? ALL_SCENARIOS
    : ALL_SCENARIOS[SELECTED_SCENARIO]
        ? { [SELECTED_SCENARIO]: ALL_SCENARIOS[SELECTED_SCENARIO] }
        : null;

if (!scenarios) {
    throw new Error(`Unknown SCENARIO=${SELECTED_SCENARIO}. Use one of: all, smoke, load, spike, soak`);
}

export const options = {
    scenarios,
    tlsVersion: { min: 'tls1.2', max: 'tls1.2' },
    thresholds: {
        http_req_failed: ['rate<0.02'],      // < 2% failures
        http_req_duration: ['p(95)<1500'],   // p95 < 1.5s
        http_req_waiting: ['p(95)<1000'],    // TTFB p95 < 1s
        errors: ['rate<0.02'],
    },
    summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'max'],
};

function collectChecks(group, all = []) {
    if (!group) return all;

    if (Array.isArray(group.checks)) {
        all.push(...group.checks);
    }

    if (Array.isArray(group.groups)) {
        for (const child of group.groups) {
            collectChecks(child, all);
        }
    }

    return all;
}

function toPct(value) {
    return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function toMs(value) {
    return `${Number(value || 0).toFixed(2)} ms`;
}

export function handleSummary(data) {
    const thresholdMetrics = ['errors', 'http_req_failed', 'http_req_duration', 'http_req_waiting'];
    const thresholdLines = [];
    const failedThresholds = [];

    for (const metricName of thresholdMetrics) {
        const metric = data.metrics[metricName];
        if (!metric || !metric.thresholds) continue;

        for (const [rule, result] of Object.entries(metric.thresholds)) {
            const status = result.ok ? 'PASS' : 'FAIL';
            const actual = rule.startsWith('rate')
                ? toPct(metric.values.rate)
                : rule.startsWith('p(95)')
                    ? toMs(metric.values['p(95)'])
                    : 'n/a';

            if (!result.ok) {
                failedThresholds.push({ metricName, rule });
            }

            thresholdLines.push(`- ${status} | ${metricName} (${rule}) | actual: ${actual}`);
        }
    }

    const checks = collectChecks(data.root_group);
    const failedChecks = checks.filter((c) => c.fails > 0);
    const hasReliabilityFailure = failedThresholds.some((t) => t.metricName === 'errors' || t.metricName === 'http_req_failed');
    const hasLatencyFailure = failedThresholds.some((t) => t.metricName === 'http_req_duration' || t.metricName === 'http_req_waiting');
    const verdict = failedThresholds.length === 0
        ? 'PASS: all thresholds met.'
        : hasReliabilityFailure && hasLatencyFailure
            ? 'FAIL: both reliability and latency thresholds were breached.'
            : hasReliabilityFailure
                ? 'FAIL: reliability thresholds were breached (request/check failures).'
                : 'FAIL: latency thresholds were breached (performance too slow).';

    const lines = [
        '',
        '========== BEGINNER LOAD TEST SUMMARY ==========',
        `Scenario selected: ${SELECTED_SCENARIO}`,
        `Final verdict: ${verdict}`,
        '',
        '1) Gate result (thresholds):',
        ...(thresholdLines.length ? thresholdLines : ['- No thresholds found in summary']),
        '',
        '2) Main health metrics:',
        `- Failed request rate (http_req_failed): ${toPct(data.metrics.http_req_failed?.values?.rate)}`,
        `- Custom error rate (errors): ${toPct(data.metrics.errors?.values?.rate)}`,
        `- Response time p95 (http_req_duration): ${toMs(data.metrics.http_req_duration?.values?.['p(95)'])}`,
        `- TTFB p95 (http_req_waiting): ${toMs(data.metrics.http_req_waiting?.values?.['p(95)'])}`,
        '',
        '3) Failing checks (what is breaking):',
        ...(failedChecks.length
            ? failedChecks.map((c) => `- ${c.name}: fails=${c.fails}, passes=${c.passes}`)
            : ['- No failing checks']),
        '',
        'How to read quickly:',
        '- Any FAIL in section 1 = run is not accepted.',
        '- In section 3, repeated failures on the same endpoint usually indicate the root cause.',
        '- If p95 is above threshold, performance is too slow for your target.',
        '=================================================',
        '',
    ];

    return {
        stdout: lines.join('\n'),
        'k6-summary.json': JSON.stringify(data, null, 2),
    };
}

// Logs in ONCE for the whole run (not per VU/iteration) via the real login API
// (`POST /api/v1/auth/login`, confirmed 2026-09-24 via a real browser network capture - the same
// endpoint the login form itself calls) and returns the two session cookies it sets
// (`.AspNetCore.Identity.Application` / `.AspNetCore.Session`). k6's `setup()` runs once before any
// VU starts, and its return value is handed to every VU - each VU then applies these same cookie
// values to its OWN cookie jar before making any portal request. This deliberately mirrors TFS's
// real, confirmed architecture (one canonical per-user session, not one per login) rather than
// logging in per-VU, which would be both slower and less representative of how the real app
// actually behaves under concurrent access from the same account.
const BROWSER_LIKE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: `${BASE_URL}/portal/login`,
    Origin: BASE_URL,
};

export function setup() {
    const loginRes = http.post(
        `${BASE_URL}/api/v1/auth/login`,
        JSON.stringify({ username: TFS_EMAIL, password: TFS_PASSWORD }),
        {
            headers: { ...BROWSER_LIKE_HEADERS, 'Content-Type': 'application/json', 'x-brand': 'portal' },
            tags: { endpoint: '/api/v1/auth/login' },
        }
    );

    // Deliberately does NOT log loginRes.body or the request body anywhere - both can contain
    // session/credential material. Only the status code and response HEADERS are ever surfaced.
    if (loginRes.status !== 200) {
        throw new Error(`Login failed with status ${loginRes.status} - check TFS_EMAIL/TFS_PASSWORD and BASE_URL. Response headers: ${JSON.stringify(loginRes.headers)}. (Response body withheld - may contain sensitive data.)`);
    }

    // Confirmed 2026-09-24: reading raw `Set-Cookie` response headers directly is unreliable here -
    // k6's `res.headers` map only ever surfaced the LAST of the response's multiple Set-Cookie
    // headers (a common gotcha with naive header maps, since most other header names are safe to
    // comma-join but Set-Cookie values often contain their own commas/semicolons). k6's dedicated
    // `res.cookies` property correctly keeps every cookie separate regardless of how many
    // Set-Cookie headers the response sent.
    const cookies = {};
    for (const [name, entries] of Object.entries(loginRes.cookies || {})) {
        if (entries && entries.length) cookies[name] = entries[0].value;
    }

    const requiredCookies = ['.AspNetCore.Identity.Application', '.AspNetCore.Session'];
    const missing = requiredCookies.filter((name) => !cookies[name]);
    if (missing.length) {
        throw new Error(`Login succeeded (200) but the expected session cookie(s) were not set: ${missing.join(', ')}. The app's auth response shape may have changed.`);
    }

    return { cookies };
}

function applySessionCookies(cookies) {
    const jar = http.cookieJar();
    for (const [name, value] of Object.entries(cookies)) {
        jar.set(BASE_URL, name, value);
    }
}

function requestAndCheck(path, tags = {}) {
    const res = http.get(`${BASE_URL}${path}`, {
        headers: { 'User-Agent': BROWSER_LIKE_HEADERS['User-Agent'] },
        tags: { endpoint: path, ...tags },
        redirects: 5,
        timeout: '30s',
    });

    const ok = check(res, {
        [`${path} status is 2xx/3xx`]: (r) => r.status >= 200 && r.status < 400,
        [`${path} has content`]: (r) => (r.body || '').length > 0,
        // A real, confirmed regression this project has run into before (see login-helpers.js /
        // portal-helpers.js): a session that silently isn't authenticated redirects to the login
        // page rather than erroring - catch that here so a broken session shows up as a clear
        // check failure rather than a misleadingly "successful" 200 on the wrong page.
        [`${path} did not redirect to login (session still valid)`]: (r) => !/\/portal\/login/i.test((r.url || '')),
    });

    errorRate.add(!ok);
    ttfbTrend.add(res.timings.waiting, { endpoint: path });
    durationTrend.add(res.timings.duration, { endpoint: path });

    return res;
}

// Portal pages only - excludes Site Locator (its own page body is a third-party iframe embedding
// stationfinder.co.uk, so hitting it here would load-test a third party's infrastructure, not
// TFS's own) and Contact (confirmed in 11-tfs.contact.spec.js to resolve to a completely different,
// UNAUTHENTICATED public marketing page on Live - not a meaningful portal load-test target either).
export function browsePortalPages(data) {
    applySessionCookies(data.cookies);

    requestAndCheck('/portal/');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/portal/account-details');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/portal/invoices');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/portal/transactions');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/portal/payments');
    sleep(Math.random() * 1 + 0.2);

    // Randomized navigation mix
    const extra = [
        '/portal/manage-cards',
        '/portal/additional-services',
        '/portal/faq',
        '/portal/',
    ];
    const randomPath = extra[Math.floor(Math.random() * extra.length)];
    requestAndCheck(randomPath, { type: 'random' });

    sleep(Math.random() * 1.5 + 0.5);
}
