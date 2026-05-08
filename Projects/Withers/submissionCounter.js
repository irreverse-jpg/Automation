const fs = require('fs');
const path = require('path');

const COUNTER_FILE = path.join(__dirname, 'submission-counter.txt');

function getCurrentSubmissionNumber() {
    let num = 1;
    if (fs.existsSync(COUNTER_FILE)) {
        num = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8'), 10);
    }
    return Number.isFinite(num) && num > 0 ? num : 1;
}

function incrementSubmissionNumber() {
    const num = getCurrentSubmissionNumber() + 1;
    fs.writeFileSync(COUNTER_FILE, num.toString(), 'utf8');
}

module.exports = { getCurrentSubmissionNumber, incrementSubmissionNumber };