import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || __ENV.CAREUK_BASE_URL || __ENV.K6_BASE_URL || '').replace(/\/+$/, '');
const SELECTED_SCENARIO = (__ENV.SCENARIO || 'all').trim().toLowerCase();
const ORIGIN = (BASE_URL.match(/^https?:\/\/[^/]+/i) || [''])[0];

if (!BASE_URL) {
    throw new Error('BASE_URL is required. Example: BASE_URL=https://www.careuk.com');
}

const errorRate = new Rate('errors');
const ttfbTrend = new Trend('ttfb_ms');
const durationTrend = new Trend('duration_ms');

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
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<1500'],
        http_req_waiting: ['p(95)<1000'],
        errors: ['rate<0.02'],
    },
    summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'max'],
};

function toPct(value) {
    return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function toMs(value) {
    return `${Number(value || 0).toFixed(2)} ms`;
}

function requestPage(url, label) {
    const response = http.get(url, { tags: { name: label } });
    const ok = check(response, {
        [`${label} returned 2xx or 3xx`]: (res) => res.status >= 200 && res.status < 400,
    });

    errorRate.add(!ok);
    ttfbTrend.add(response.timings.waiting);
    durationTrend.add(response.timings.duration);
    sleep(1);
}

export function browseCorePages() {
    const pages = [
        { path: '/', label: 'homepage' },
        { path: '/about-us', label: 'about-us' },
        { path: '/care-homes', label: 'care-homes' },
        { path: '/our-care', label: 'our-care' },
        { path: '/advice-and-support', label: 'advice-and-support' },
        { path: '/contact-us', label: 'contact-us' },
    ];

    for (const page of pages) {
        requestPage(`${BASE_URL}${page.path}`, page.label);
    }

    if (ORIGIN) {
        requestPage(`${ORIGIN}/robots.txt`, 'robots.txt');
        requestPage(`${ORIGIN}/sitemap.xml`, 'sitemap.xml');
    }
}

export function handleSummary(data) {
    const thresholdMetrics = ['errors', 'http_req_failed', 'http_req_duration', 'http_req_waiting'];
    const thresholdLines = [];

    for (const metricName of thresholdMetrics) {
        const metric = data.metrics[metricName];
        if (!metric || !metric.thresholds) continue;

        for (const [rule, result] of Object.entries(metric.thresholds)) {
            const status = result.ok ? 'PASS' : 'FAIL';
            const actual = rule.startsWith('rate')
                ? toPct(metric.values.rate)
                : toMs(metric.values['p(95)']);
            thresholdLines.push(`- ${status} | ${metricName} (${rule}) | actual: ${actual}`);
        }
    }

    const lines = [
        '',
        '========== CAREUK LOAD TEST SUMMARY ==========',
        `Scenario selected: ${SELECTED_SCENARIO}`,
        '',
        'Thresholds:',
        ...(thresholdLines.length ? thresholdLines : ['- No thresholds found in summary']),
        '',
        `Failed request rate: ${toPct(data.metrics.http_req_failed?.values?.rate)}`,
        `Custom error rate: ${toPct(data.metrics.errors?.values?.rate)}`,
        `Response time p95: ${toMs(data.metrics.http_req_duration?.values?.['p(95)'])}`,
        `TTFB p95: ${toMs(data.metrics.http_req_waiting?.values?.['p(95)'])}`,
        '=============================================',
        '',
    ];

    return {
        stdout: lines.join('\n'),
        'k6-summary.json': JSON.stringify(data, null, 2),
    };
}
