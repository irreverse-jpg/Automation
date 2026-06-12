const fs = require('fs');
const path = require('path');

const COUNTER_FILE = path.join(__dirname, 'submission-counter.txt');

function readCounterStore() {
    if (!fs.existsSync(COUNTER_FILE)) {
        return {};
    }

    const rawValue = fs.readFileSync(COUNTER_FILE, 'utf8').trim();
    if (!rawValue) {
        return {};
    }

    try {
        const parsed = JSON.parse(rawValue);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        const numericValue = parseInt(rawValue, 10);
        return Number.isFinite(numericValue) && numericValue > 0
            ? { default: numericValue }
            : {};
    }
}

function writeCounterStore(counterStore) {
    fs.writeFileSync(COUNTER_FILE, `${JSON.stringify(counterStore, null, 2)}\n`, 'utf8');
}

function getCurrentSubmissionNumber(counterKey = 'default') {
    const counterStore = readCounterStore();
    const counterValue = counterStore[counterKey];
    return Number.isFinite(counterValue) && counterValue > 0 ? counterValue : 1;
}

function incrementSubmissionNumber(counterKey = 'default') {
    const counterStore = readCounterStore();
    const nextValue = getCurrentSubmissionNumber(counterKey) + 1;
    counterStore[counterKey] = nextValue;
    writeCounterStore(counterStore);
}

module.exports = { getCurrentSubmissionNumber, incrementSubmissionNumber };