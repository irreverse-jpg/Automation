// ============================================================================
// Findings Reporter
// ============================================================================
// Produces a plain-language "findings" spreadsheet after a test run, meant to
// be opened by anyone on the team in Excel - not just testers. For every
// failing test it records WHERE the issue was seen (the page's web address),
// WHICH page or feature it belongs to, and WHY it's an issue (in everyday
// wording, not code/CSS/technical jargon). Passed tests are summarized as
// counts only on a separate Summary sheet - this report is about problems
// worth someone's attention, not the full technical log (that's what the
// existing HTML reporter is for).
//
// How it finds the URL: each spec file has a small `test.afterEach` hook
// that, only when a test fails, attaches a "failure-context" JSON blob
// (page URL, page title, viewport, environment) to the test result. This
// reporter reads that attachment. If a test fails before the hook can run
// (e.g. the very first navigation), the URL falls back to a "Not captured"
// note for that row.
// ============================================================================

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const FRIENDLY_FILE_NAMES = {
    '01-rsc.homepage.spec.js': 'Homepage',
    '09-rsc.nonfunctional.spec.js': 'Technical Health (SEO/Security/Accessibility)',
};

const FRIENDLY_PROJECT_NAMES = {
    'desktop-chromium': 'Desktop',
    'tablet-chromium': 'Tablet',
    'mobile-chromium': 'Mobile',
};

// Plain-language swaps applied to assertion messages so the report reads
// naturally for anyone, not just testers. Keep this list small and safe -
// only swap terms that have an unambiguous everyday equivalent.
const PLAIN_LANGUAGE_SWAPS = [
    [/\b404\b/gi, 'a "page not found" error'],
    [/\bCTA\b/gi, 'button/link'],
    [/\bH1\b/gi, 'main heading'],
    [/\bURL\b/gi, 'web address'],
    [/\bhref\b/gi, 'link'],
    [/\bviewport\b/gi, 'screen size'],
    [/\bdead\/not-found link\b/gi, 'broken link'],
    [/\bselector\b/gi, 'element'],
];

function toFriendlyFileName(filePath) {
    const base = path.basename(filePath);
    return FRIENDLY_FILE_NAMES[base] || base;
}

function toFriendlyProjectName(projectName) {
    return FRIENDLY_PROJECT_NAMES[projectName] || projectName || 'Unknown';
}

function stripAnsiCodes(value) {
    return String(value || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function plainLanguage(message) {
    let cleaned = stripAnsiCodes(message).split('\n')[0].trim();
    cleaned = cleaned.replace(/^Error:\s*/i, '');
    for (const [pattern, replacement] of PLAIN_LANGUAGE_SWAPS) {
        cleaned = cleaned.replace(pattern, replacement);
    }
    return cleaned || 'No further detail was captured for this issue.';
}

function readFailureContext(result) {
    const attachment = (result.attachments || []).find((a) => a.name === 'failure-context');
    if (!attachment) return null;

    try {
        const raw = attachment.body ? attachment.body.toString('utf-8') : fs.readFileSync(attachment.path, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

class FindingsReporter {
    constructor(options = {}) {
        this.outputDir = options.outputDir || path.join(__dirname, '..');
        this.findings = [];
        this.totalTests = 0;
        this.passedTests = 0;
    }

    onTestEnd(test, result) {
        this.totalTests += 1;

        if (result.status === 'passed' || result.status === 'skipped') {
            if (result.status === 'passed') this.passedTests += 1;
            return;
        }

        const specFile = toFriendlyFileName(test.location.file);
        const projectName = toFriendlyProjectName(test.parent && test.parent.project ? test.parent.project().name : '');
        const context = readFailureContext(result);
        const firstError = (result.errors && result.errors[0]) || {};

        this.findings.push({
            specFile,
            testTitle: test.title,
            projectName: context?.viewport ? toFriendlyProjectName(context.viewport) : projectName,
            environment: context?.environment || 'Not captured',
            url: context?.url || 'Not captured (issue happened before the page finished loading)',
            why: plainLanguage(firstError.message),
        });
    }

    async onEnd() {
        const timestamp = new Date();
        const stamp = timestamp.toISOString().replace(/[:.]/g, '-');

        const workbook = this.buildWorkbook(timestamp);

        const latestPath = path.join(this.outputDir, 'findings-report.xlsx');
        await workbook.xlsx.writeFile(latestPath);

        const archiveDir = path.join(this.outputDir, 'findings-reports');
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
        await workbook.xlsx.writeFile(path.join(archiveDir, `findings-${stamp}.xlsx`));

        console.log(`\nFindings report written: ${latestPath}`);
        console.log(`(${this.findings.length} finding(s) out of ${this.totalTests} test(s) run)`);
    }

    buildWorkbook(timestamp) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'RSC QA Automation';
        workbook.created = timestamp;

        this.addSummarySheet(workbook, timestamp);
        this.addFindingsSheet(workbook);

        return workbook;
    }

    addSummarySheet(workbook, timestamp) {
        const sheet = workbook.addWorksheet('Summary');
        sheet.columns = [{ width: 28 }, { width: 50 }];

        sheet.addRow(['RSC Website - Test Findings']).font = { bold: true, size: 16 };
        sheet.addRow([`Generated ${timestamp.toLocaleString('en-GB')}`]);
        sheet.addRow([]);

        const summaryRows = [
            ['Checks run', this.totalTests],
            ['Passed', this.passedTests],
            ['Findings to review', this.findings.length],
        ];
        for (const row of summaryRows) {
            const excelRow = sheet.addRow(row);
            excelRow.getCell(1).font = { bold: true };
        }

        sheet.addRow([]);
        if (this.findings.length === 0) {
            sheet.addRow(['No issues found in this run - everything checked passed.']).font = { bold: true, color: { argb: 'FF1E5E34' } };
        } else {
            sheet.addRow(['See the "Findings" sheet for full details on each issue.']);
        }
    }

    addFindingsSheet(workbook) {
        const sheet = workbook.addWorksheet('Findings', { views: [{ state: 'frozen', ySplit: 1 }] });

        sheet.columns = [
            { header: 'Which page/feature', key: 'specFile', width: 28 },
            { header: 'Test', key: 'testTitle', width: 40 },
            { header: 'Where (page address)', key: 'url', width: 55 },
            { header: 'Seen on', key: 'seenOn', width: 22 },
            { header: "Why it's an issue", key: 'why', width: 70 },
        ];

        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF041E42' } };
            cell.alignment = { vertical: 'middle' };
        });

        for (const finding of this.findings) {
            const row = sheet.addRow({
                specFile: finding.specFile,
                testTitle: finding.testTitle,
                url: finding.url,
                seenOn: `${finding.projectName} - ${finding.environment}`,
                why: finding.why,
            });

            row.alignment = { vertical: 'top', wrapText: true };

            const urlCell = row.getCell('url');
            if (/^https?:\/\//i.test(finding.url)) {
                urlCell.value = { text: finding.url, hyperlink: finding.url };
                urlCell.font = { color: { argb: 'FF0A5CD6' }, underline: true };
            }
        }

        sheet.autoFilter = { from: 'A1', to: 'E1' };
    }
}

module.exports = FindingsReporter;
