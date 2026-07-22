import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || __ENV.MCC_BASE_URL || __ENV.K6_BASE_URL || '').replace(/\/+$/, '');
const SELECTED_SCENARIO = (__ENV.SCENARIO || 'all').trim().toLowerCase();
const ORIGIN = (BASE_URL.match(/^https?:\/\/[^/]+/i) || [''])[0];

if (!BASE_URL) {
    throw new Error('BASE_URL is required. Example: BASE_URL=https://lords-uat2.hosted.positive.co.uk');
}

const errorRate = new Rate('errors');
const ttfbTrend = new Trend('ttfb_ms');
const durationTrend = new Trend('duration_ms');

/*
QUICK GUIDE (k6 load tests)
====================================

What this file does
-------------------
- Runs simple GET-only journeys against core MCC/Lord's pages.
- Measures reliability (failures) and speed (response times).
- Prints a summary at the end with a clear final verdict.

Scenarios available
-------------------
- smoke: quick health check (small run)
- load: normal expected traffic pattern
- spike: sudden traffic surge
- soak: longer stability run
- all: runs all scenarios together

How to run (PowerShell)
-----------------------
The script path is relative to your current working directory.
Replace BASE_URL if needed, example for UAT2.

From the Projects folder (cd .../Projects):
- Smoke:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=smoke MCC/14-mcc.load.k6.js
- Load:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=load MCC/14-mcc.load.k6.js
- Spike:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=spike MCC/14-mcc.load.k6.js
- Soak:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=soak MCC/14-mcc.load.k6.js
- All scenarios:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk MCC/14-mcc.load.k6.js

From the MCC folder (cd .../Projects/MCC):
- Smoke:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=smoke 14-mcc.load.k6.js
- Load:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=load 14-mcc.load.k6.js
- Spike:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=spike 14-mcc.load.k6.js
- Soak:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk --env SCENARIO=soak 14-mcc.load.k6.js
- All scenarios:
    k6 run --env BASE_URL=https://lords-uat2.hosted.positive.co.uk 14-mcc.load.k6.js

What pages this script exercises
--------------------------------
- Core pages under BASE_URL:
    - / (homepage)
    - /lords/match-day/fixtures-and-results (Fixtures and Results)
    - /lords/lord-s-experience/tours (Tours and Museum)
    - /mcc/the-club/about-us (About Us)
    - /careers/vacancies (Careers)
    - /lords/visit-us/contact (Contact)
- Root-level technical endpoints from the site origin:
    - /robots.txt
    - /sitemap.xml

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
- each iteration executes browseCorePages()
- browseCorePages() requests core pages + one random extra page
- thresholds decide pass/fail for reliability and latency

What load specifically means in this script
-------------------------------------------
- starts with 1 virtual user (startVUs: 1)
- ramps to 10 users over 2 minutes
- holds 10 users for 5 minutes
- ramps down to 0 users over 2 minutes
- total planned pattern is about 9 minutes (+ graceful ramp-down)
- each active user repeats browseCorePages() for the full stage pattern

What spike specifically means in this script
--------------------------------------------
- starts near baseline traffic (1 user)
- rapidly spikes to 40 users in 30 seconds
- holds 40 users for 2 minutes
- drops back down to 1 user in 30 seconds
- used to test sudden traffic shock behavior
- each active user repeats browseCorePages() during the spike profile

What soak specifically means in this script
-------------------------------------------
- runs 5 constant virtual users (vus: 5)
- duration is 10 minutes (continuous)
- used to check stability over time (not just short burst speed)
- each active user continuously repeats browseCorePages()

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
        exec: 'browseCorePages',
    },
    load: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
            { duration: '2m', target: 10 },
            { duration: '5m', target: 10 },
            { duration: '2m', target: 0 },
        ],
        exec: 'browseCorePages',
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
        exec: 'browseCorePages',
        gracefulRampDown: '30s',
    },
    soak: {
        executor: 'constant-vus',
        vus: 5,
        duration: '10m',
        exec: 'browseCorePages',
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

function getRequestUrl(path, { rootLevel = false } = {}) {
    return rootLevel ? `${ORIGIN}${path}` : `${BASE_URL}${path}`;
}

function requestAndCheck(path, tags = {}, optionsForRequest = {}) {
    const requestUrl = getRequestUrl(path, optionsForRequest);
    const res = http.get(requestUrl, {
        tags: { endpoint: path, ...tags },
        redirects: 5,
        timeout: '30s',
    });

    const ok = check(res, {
        [`${path} status is 2xx/3xx`]: (r) => r.status >= 200 && r.status < 400,
        [`${path} has content`]: (r) => (r.body || '').length > 0,
    });

    errorRate.add(!ok);
    ttfbTrend.add(res.timings.waiting, { endpoint: path });
    durationTrend.add(res.timings.duration, { endpoint: path });

    return res;
}

export function browseCorePages() {
    // Core pages/endpoints (safe GET-only flow)
    requestAndCheck('/');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/lords/match-day/fixtures-and-results');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/lords/lord-s-experience/tours');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/mcc/the-club/about-us');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/careers/vacancies');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/lords/visit-us/contact');
    sleep(Math.random() * 1 + 0.2);

    requestAndCheck('/robots.txt', { type: 'seo' }, { rootLevel: true });
    requestAndCheck('/sitemap.xml', { type: 'seo' }, { rootLevel: true });

    // Randomized navigation mix
    const extra = [
        '/',
        '/lords/match-day/fixtures-and-results',
        '/lords/lord-s-experience/tours',
        '/mcc/the-club/about-us',
        '/careers/vacancies',
    ];
    const randomPath = extra[Math.floor(Math.random() * extra.length)];
    requestAndCheck(randomPath, { type: 'random' });

    sleep(Math.random() * 1.5 + 0.5);
}
