import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || __ENV.K6_BASE_URL || 'https://withers-qa.example.com';
const SCENARIO = __ENV.SCENARIO || 'smoke';

const profiles = {
    smoke: { vus: 1, duration: '30s' },
    load: { vus: 10, duration: '2m' },
    spike: { vus: 30, duration: '30s' },
    soak: { vus: 5, duration: '15m' },
};

export const options = {
    scenarios: {
        [SCENARIO]: {
            executor: 'constant-vus',
            vus: profiles[SCENARIO]?.vus || 1,
            duration: profiles[SCENARIO]?.duration || '30s',
        },
    },
};

export default function () {
    const res = http.get(`${BASE_URL}/`);
    check(res, {
        'status is < 400': (r) => r.status < 400,
        'has body': (r) => !!r.body,
    });
    sleep(1);
}
