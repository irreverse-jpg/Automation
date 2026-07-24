const ExcelJS = require('exceljs');

const COLORS = {
    headerFill: 'FF1F3864',
    headerFont: 'FFFFFFFF',
    baseFieldFill: 'FFDDEBF7',
    conditionalFieldFill: 'FFFFFFFF',
    requiredFill: 'FFFCE4D6',
    defectFill: 'FFFFC7CE',
    defectFont: 'FF9C0006',
    sectionFill: 'FF2E5395',
    gapFill: 'FFFFF2CC',
    gapFont: 'FF9C6500',
};

const BORDER = {
    top: { style: 'thin', color: { argb: 'FFB7B7B7' } },
    left: { style: 'thin', color: { argb: 'FFB7B7B7' } },
    bottom: { style: 'thin', color: { argb: 'FFB7B7B7' } },
    right: { style: 'thin', color: { argb: 'FFB7B7B7' } },
};

// -- LIVE environment data ------------------------------------------------

const LIVE_URL = 'https://www.jameswalker.biz/contact-us';
const UAT_URL = 'https://jw-uat.hosted.positive.co.uk/contact-us';

const LIVE_BASE_FIELDS = [
    { label: 'First name', type: 'Text field', required: true },
    { label: 'Last name', type: 'Text field', required: true },
    { label: 'Company', type: 'Text field', required: true },
    { label: 'Industry', type: 'Dropdown (19 industries + "-- Select --")', required: true },
    { label: 'Job title', type: 'Text field', required: false },
    { label: 'Email address', type: 'Email field', required: true },
    { label: 'Telephone number', type: 'Text field', required: false },
    { label: 'Country', type: 'Dropdown (250 countries + "-- Select --")', required: true },
    { label: 'Nature of enquiry', type: 'Dropdown (4 options + "-- Select --")', required: true },
];

const LIVE_TAIL_FIELDS = [
    { label: 'Additional information', type: 'Text area (multi-line)', required: false },
];

const RECAPTCHA_NOTE = 'reCAPTCHA ("I\'m not a robot" check) — not a visible form field and has no asterisk, but the form blocks submission until it is completed, on every journey/environment.';

const LIVE_JOURNEYS = [
    {
        id: 'Journey 1',
        title: 'Initial Page Load',
        selection: '-- Select -- (no option chosen yet)',
        description: 'The default state of the form before the user has interacted with the "Nature of enquiry" dropdown at all.',
        conditionalFields: [],
        notes: 'No conditional fields are shown yet — only the 9 base fields plus "Additional information".',
    },
    {
        id: 'Journey 2',
        title: 'Nature of Enquiry: General/customer service enquiry',
        selection: 'General/customer service enquiry',
        description: 'User selects the first dropdown option, intended for general/customer service questions.',
        conditionalFields: [],
        notes: 'This option adds NO extra conditional fields — the form looks identical to Journey 1 (initial load).',
    },
    {
        id: 'Journey 3',
        title: 'Nature of Enquiry: Product or service quotation request',
        selection: 'Product or service quotation request',
        description: 'User selects the option for requesting a quote on a product or service.',
        conditionalFields: [
            { label: 'Product / service details', type: 'Text field', required: false },
            { label: 'Material', type: 'Text field', required: false },
            { label: 'Part number', type: 'Text field', required: false },
            { label: 'Quantity', type: 'Text field', required: true },
            { label: 'Application details (STAMPS)', type: 'Text field', required: false },
            { label: 'Required delivery date', type: 'Date picker', required: false, defect: true },
            { label: 'Detailed quotation or basic estimation', type: 'Dropdown ("Detailed quotation" / "Basic estimation" + "-- Select --")', required: false },
            { label: 'Upload drawings / specifications', type: 'File upload', required: false },
        ],
        notes: 'Adds 8 conditional fields. See "Required delivery date" — flagged in Validation Findings.',
    },
    {
        id: 'Journey 4',
        title: 'Nature of Enquiry: Technical enquiry',
        selection: 'Technical enquiry',
        description: 'User selects the option for a technical/product support enquiry.',
        conditionalFields: [
            { label: 'Issue / problem', type: 'Text field', required: false },
            { label: 'Product(s) currently in use', type: 'Text field', required: false },
            { label: 'Application details (STAMPS)', type: 'Text field', required: false },
            { label: 'Upload drawings / images / notes', type: 'File upload', required: false },
        ],
        notes: 'Adds 4 conditional fields, all optional. No validation anomalies found.',
    },
    {
        id: 'Journey 5',
        title: 'Nature of Enquiry: I wish to become a supplier',
        selection: 'I wish to become a supplier',
        description: 'User selects the option to register interest in becoming a supplier.',
        conditionalFields: [
            { label: 'Product / service you wish to supply', type: 'Text field', required: false },
            { label: 'Local / regional / global supply', type: 'Text field', required: false },
        ],
        notes: 'Adds 2 conditional fields, both optional. No validation anomalies found.',
    },
];

// -- UAT environment data --------------------------------------------------
// UAT does not yet implement the conditional-field logic: the same static
// field set is shown no matter which "Nature of enquiry" option is chosen.

const UAT_DROPDOWN_OPTIONS = ['-- Select --', 'Enquiry / quote request', 'Something went wrong', 'Become a supplier'];

// Field order as it actually appears on the UAT page (differs from Live's order).
const UAT_FIELDS = [
    { label: 'Nature of enquiry', type: `Dropdown (3 options + "-- Select --")`, required: true },
    { label: 'Full name', type: 'Text field', required: true },
    { label: 'Email address', type: 'Email field', required: true },
    { label: 'Company', type: 'Text field', required: true },
    { label: 'Job title', type: 'Text field', required: false },
    { label: 'Telephone number', type: 'Text field', required: false },
    { label: 'Country', type: 'Dropdown (250 countries + "-- Select --")', required: true },
    { label: 'Industry', type: 'Dropdown (19 industries + "-- Select --")', required: true },
    { label: 'Additional information', type: 'Text area (multi-line)', required: true },
];

// -- Workbook building ----------------------------------------------------

async function build() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QA Automation';
    wb.created = new Date('2026-07-24T00:00:00Z');

    buildOverviewSheet(wb);
    for (const journey of LIVE_JOURNEYS) {
        buildLiveJourneySheet(wb, journey);
    }
    buildUatSheet(wb);
    buildEnvironmentComparisonSheet(wb);
    buildValidationFindingsSheet(wb);
    buildCrossDeviceSheet(wb);

    await wb.xlsx.writeFile('James-Walker-Contact-Form-Field-Mapping.xlsx');
    console.log('Workbook written.');
}

function styleHeaderRow(row) {
    row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: COLORS.headerFont }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerFill } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.border = BORDER;
    });
    row.height = 22;
}

function buildOverviewSheet(wb) {
    const ws = wb.addWorksheet('Overview', { views: [{ state: 'frozen', ySplit: 0 }] });
    ws.columns = [{ width: 4 }, { width: 100 }];

    let r = 1;
    const title = ws.getCell(`A${r}`);
    ws.mergeCells(`A${r}:B${r}`);
    title.value = 'James Walker — Contact Us Form: Conditional Field Mapping (Live vs UAT)';
    title.font = { bold: true, size: 16, color: { argb: COLORS.headerFill } };
    r += 2;

    const meta = [
        ['Live page under test', LIVE_URL],
        ['UAT page under test', UAT_URL],
        ['Form name', '"How can we help you?" contact enquiry form'],
        ['Date mapped', '24 July 2026'],
        ['Trigger field', '"Nature of enquiry" dropdown — on Live, drives which extra fields appear; on UAT, has no effect on the field set (see below)'],
        ['Method', 'Each dropdown option was selected in turn on a fresh page load of both environments; the resulting visible form fields, their type, and required (asterisk) status were captured directly from the live/UAT page. The form was also submitted fully empty for every state to confirm which fields produce a validation error.'],
    ];
    for (const [k, v] of meta) {
        ws.getCell(`A${r}`).value = k;
        ws.getCell(`A${r}`).font = { bold: true };
        ws.mergeCells(`B${r}:B${r}`);
        const cell = ws.getCell(`B${r}`);
        cell.value = v;
        cell.alignment = { wrapText: true, vertical: 'top' };
        r += 1;
    }
    r += 1;

    ws.mergeCells(`A${r}:B${r}`);
    const gapCell = ws.getCell(`A${r}`);
    gapCell.value = 'KEY ENVIRONMENT GAP: UAT does not currently have the conditional-field logic implemented. Selecting any "Nature of enquiry" option on UAT shows the same static 9 fields every time — none of the Live environment\'s extra conditional fields (Quantity, Required delivery date, Issue / problem, etc.) exist on UAT yet. See the "Environment Comparison" and "UAT - Current Form" tabs for full detail.';
    gapCell.font = { bold: true, color: { argb: COLORS.gapFont } };
    gapCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gapFill } };
    gapCell.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 55;
    r += 2;

    ws.getCell(`A${r}`).value = 'Tabs in this workbook:';
    ws.getCell(`A${r}`).font = { bold: true };
    r += 1;
    for (const j of LIVE_JOURNEYS) {
        ws.getCell(`A${r}`).value = `Live ${j.id}`;
        ws.getCell(`B${r}`).value = `${j.title} — ${j.conditionalFields.length} conditional field(s) added`;
        r += 1;
    }
    ws.getCell(`A${r}`).value = 'UAT - Current Form';
    ws.getCell(`B${r}`).value = 'The single, static field set shown on UAT regardless of "Nature of enquiry" selection.';
    r += 1;
    ws.getCell(`A${r}`).value = 'Environment Comparison';
    ws.getCell(`B${r}`).value = 'Side-by-side differences between Live and UAT: field naming, dropdown options, required-ness, and the conditional-logic gap.';
    r += 1;
    ws.getCell(`A${r}`).value = 'Validation Findings';
    ws.getCell(`B${r}`).value = 'Empty-submission validation results for every Live journey and for UAT.';
    r += 1;
    ws.getCell(`A${r}`).value = 'Cross-Device Compatibility';
    ws.getCell(`B${r}`).value = 'Same field mapping and validation checks repeated on tablet (iPad Pro 11) and mobile (Pixel 7) viewports for Live and UAT.';
    r += 2;

    ws.getCell(`A${r}`).value = 'Legend';
    ws.getCell(`A${r}`).font = { bold: true };
    r += 1;
    const legendRows = [
        ['Required = Yes', 'Field is marked with a red asterisk (*) on the page AND correctly blocks submission when left blank.'],
        ['Required = No', 'Field has no asterisk and is genuinely optional — blank submission does not error, unless flagged otherwise below.'],
        ['⚠ Validation defect', 'Field has NO visible asterisk (looks optional) but the form still blocks submission when it is left blank — a mismatch between what the page shows and how it behaves. See the "Validation Findings" tab.'],
        ['🟡 Environment gap', 'Behaviour differs between Live and UAT because UAT has not yet implemented a piece of Live functionality (the conditional fields).'],
    ];
    for (const [k, v] of legendRows) {
        const kCell = ws.getCell(`A${r}`);
        kCell.value = k;
        kCell.font = { bold: true };
        if (k.includes('⚠')) {
            kCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.defectFill } };
            kCell.font = { bold: true, color: { argb: COLORS.defectFont } };
        } else if (k.includes('🟡')) {
            kCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gapFill } };
            kCell.font = { bold: true, color: { argb: COLORS.gapFont } };
        } else if (k.includes('Yes')) {
            kCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.requiredFill } };
        }
        ws.getCell(`B${r}`).value = v;
        ws.getCell(`B${r}`).alignment = { wrapText: true };
        r += 1;
    }
}

function buildLiveJourneySheet(wb, journey) {
    const safeName = journey.id.replace('Journey ', 'J');
    const ws = wb.addWorksheet(`Live ${safeName} - ${shortTitle(journey.title)}`, {
        views: [{ state: 'frozen', ySplit: 6 }],
    });
    ws.columns = [
        { width: 5 },
        { width: 45 },
        { width: 45 },
        { width: 14 },
        { width: 55 },
    ];

    ws.mergeCells('A1:E1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `LIVE — ${journey.id}: ${journey.title}`;
    titleCell.font = { bold: true, size: 14, color: { argb: COLORS.headerFill } };
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:E2');
    const selCell = ws.getCell('A2');
    selCell.value = `"Nature of enquiry" selection: ${journey.selection}`;
    selCell.font = { italic: true };

    ws.mergeCells('A3:E3');
    const descCell = ws.getCell('A3');
    descCell.value = journey.description;
    descCell.alignment = { wrapText: true };

    ws.mergeCells('A4:E4');
    const notesCell = ws.getCell('A4');
    notesCell.value = `Notes: ${journey.notes}`;
    notesCell.font = { bold: true };
    notesCell.alignment = { wrapText: true };
    ws.getRow(4).height = 30;

    const headerRow = ws.getRow(6);
    headerRow.values = ['#', 'Field label', 'Field type', 'Required?', 'Comments'];
    styleHeaderRow(headerRow);

    let rowIdx = 7;
    let fieldNum = 1;

    const writeFieldRow = (field, isConditional) => {
        const row = ws.getRow(rowIdx);
        row.values = [
            fieldNum,
            field.label,
            field.type,
            field.required ? 'Yes' : 'No',
            field.defect
                ? '⚠ Not marked required, but submission is blocked if left blank — see Validation Findings tab.'
                : (isConditional ? 'Conditional field — only appears for this selection (does not exist on UAT yet).' : 'Base field — present on every journey and on UAT.'),
        ];
        row.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: 'middle', wrapText: true }; });
        const fill = field.defect ? COLORS.defectFill : (field.required ? COLORS.requiredFill : (isConditional ? COLORS.conditionalFieldFill : COLORS.baseFieldFill));
        row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; });
        if (field.defect) {
            row.getCell(5).font = { bold: true, color: { argb: COLORS.defectFont } };
        }
        rowIdx += 1;
        fieldNum += 1;
    };

    for (const f of LIVE_BASE_FIELDS) writeFieldRow(f, false);
    for (const f of journey.conditionalFields) writeFieldRow(f, true);
    for (const f of LIVE_TAIL_FIELDS) writeFieldRow(f, false);

    ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
    const capCell = ws.getCell(`A${rowIdx}`);
    capCell.value = RECAPTCHA_NOTE;
    capCell.font = { italic: true, size: 9 };
    capCell.alignment = { wrapText: true };
    ws.getRow(rowIdx).height = 28;
}

function shortTitle(title) {
    return title
        .replace('Nature of Enquiry: ', '')
        .replace('General/customer service enquiry', 'General Enquiry')
        .replace('Product or service quotation request', 'Quotation Request')
        .replace('Technical enquiry', 'Technical Enquiry')
        .replace('I wish to become a supplier', 'Become a Supplier')
        .slice(0, 28);
}

function buildUatSheet(wb) {
    const ws = wb.addWorksheet('UAT - Current Form', { views: [{ state: 'frozen', ySplit: 6 }] });
    ws.columns = [
        { width: 5 },
        { width: 45 },
        { width: 45 },
        { width: 14 },
        { width: 55 },
    ];

    ws.mergeCells('A1:E1');
    const titleCell = ws.getCell('A1');
    titleCell.value = 'UAT — Current Form (No Conditional Logic Implemented)';
    titleCell.font = { bold: true, size: 14, color: { argb: COLORS.headerFill } };
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:E2');
    ws.getCell('A2').value = `"Nature of enquiry" options on UAT: ${UAT_DROPDOWN_OPTIONS.filter(o => !o.includes('Select')).join(', ')} (note: different wording and one fewer option than Live's 4).`;
    ws.getCell('A2').font = { italic: true };

    ws.mergeCells('A3:E3');
    ws.getCell('A3').value = 'The exact same field set below is shown for the initial "-- Select --" state AND for all 3 dropdown options — selecting a different "Nature of enquiry" value has no visible effect on the form on UAT.';
    ws.getCell('A3').alignment = { wrapText: true };

    ws.mergeCells('A4:E4');
    const notesCell = ws.getCell('A4');
    notesCell.value = '🟡 Environment gap: none of Live\'s conditional fields (Product/service details, Quantity, Required delivery date, Issue/problem, Product/service you wish to supply, etc.) exist on UAT in any state.';
    notesCell.font = { bold: true, color: { argb: COLORS.gapFont } };
    notesCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gapFill } };
    notesCell.alignment = { wrapText: true };
    ws.getRow(4).height = 30;

    const headerRow = ws.getRow(6);
    headerRow.values = ['#', 'Field label', 'Field type', 'Required?', 'Comments'];
    styleHeaderRow(headerRow);

    let rowIdx = 7;
    UAT_FIELDS.forEach((field, i) => {
        const row = ws.getRow(rowIdx);
        row.values = [
            i + 1,
            field.label,
            field.type,
            field.required ? 'Yes' : 'No',
            'Static field — shown on every UAT state (initial load and all 3 dropdown options).',
        ];
        row.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: 'middle', wrapText: true }; });
        const fill = field.required ? COLORS.requiredFill : COLORS.baseFieldFill;
        row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; });
        rowIdx += 1;
    });

    ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
    const capCell = ws.getCell(`A${rowIdx}`);
    capCell.value = RECAPTCHA_NOTE;
    capCell.font = { italic: true, size: 9 };
    capCell.alignment = { wrapText: true };
    ws.getRow(rowIdx).height = 28;
}

function buildEnvironmentComparisonSheet(wb) {
    const ws = wb.addWorksheet('Environment Comparison', { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.columns = [
        { width: 32 },
        { width: 55 },
        { width: 55 },
    ];

    ws.mergeCells('A1:C1');
    const title = ws.getCell('A1');
    title.value = 'Live vs UAT — Key Differences';
    title.font = { bold: true, size: 14, color: { argb: COLORS.headerFill } };
    ws.getRow(1).height = 22;

    const headerRow = ws.getRow(3);
    headerRow.values = ['Aspect', 'Live (www.jameswalker.biz)', 'UAT (jw-uat.hosted.positive.co.uk)'];
    styleHeaderRow(headerRow);

    const rows = [
        {
            aspect: 'Conditional fields based on "Nature of enquiry"',
            live: 'Implemented — 3 of the 4 options add extra fields (Quotation request: +8, Technical enquiry: +4, Become a supplier: +2). "General/customer service enquiry" adds none.',
            uat: '🟡 NOT implemented — field set never changes, regardless of which option is chosen.',
            isGap: true,
        },
        {
            aspect: '"Nature of enquiry" dropdown options',
            live: '4 options: General/customer service enquiry, Product or service quotation request, Technical enquiry, I wish to become a supplier.',
            uat: '3 options, different wording: Enquiry / quote request, Something went wrong, Become a supplier.',
            isGap: true,
        },
        {
            aspect: 'Name field(s)',
            live: 'Two separate fields: "First name" and "Last name" (both required).',
            uat: 'One combined field: "Full name" (required).',
            isGap: true,
        },
        {
            aspect: '"Additional information" required status',
            live: 'Optional (no asterisk).',
            uat: 'Required (has asterisk) — blocks submission if left blank.',
            isGap: true,
        },
        {
            aspect: 'Field order on page',
            live: 'First name, Last name, Company, Industry, Job title, Email, Telephone, Country, Nature of enquiry, [conditional fields], Additional information.',
            uat: 'Nature of enquiry, Full name, Email, Company, Job title, Telephone, Country, Industry, Additional information.',
            isGap: false,
        },
        {
            aspect: 'Base fields present in both (Company, Job title, Email address, Telephone number, Country, Industry)',
            live: 'Present, same required/optional status as UAT.',
            uat: 'Present, same required/optional status as Live.',
            isGap: false,
        },
        {
            aspect: 'Required-field validation correctness',
            live: '⚠ One defect: "Required delivery date" (Quotation journey only) blocks submission though not asterisked. All other fields validate correctly.',
            uat: 'No defects found — every asterisked field blocks submission when blank, and only those fields.',
            isGap: false,
        },
        {
            aspect: 'reCAPTCHA',
            live: 'Present, always mandatory for submission.',
            uat: 'Present, always mandatory for submission.',
            isGap: false,
        },
    ];

    let r = 4;
    for (const row of rows) {
        const excelRow = ws.getRow(r);
        excelRow.values = [row.aspect, row.live, row.uat];
        excelRow.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: 'top', wrapText: true }; });
        excelRow.getCell(1).font = { bold: true };
        if (row.isGap) {
            excelRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gapFill } }; });
            excelRow.getCell(3).font = { bold: true, color: { argb: COLORS.gapFont } };
        }
        excelRow.height = 50;
        r += 1;
    }
}

function buildValidationFindingsSheet(wb) {
    const ws = wb.addWorksheet('Validation Findings', { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.columns = [
        { width: 30 },
        { width: 45 },
        { width: 45 },
        { width: 60 },
    ];

    ws.mergeCells('A1:D1');
    const title = ws.getCell('A1');
    title.value = 'Empty-Submission Validation Check ("Send enquiry" clicked with every field blank)';
    title.font = { bold: true, size: 14, color: { argb: COLORS.headerFill } };
    ws.getRow(1).height = 22;

    ws.mergeCells('A2:D2');
    ws.getCell('A2').value = 'For every journey (Live and UAT), the form was submitted completely empty to confirm that exactly the asterisked fields (and only those) produce a "Please enter a value." error.';
    ws.getCell('A2').alignment = { wrapText: true };
    ws.getRow(2).height = 28;

    const headerRow = ws.getRow(4);
    headerRow.values = ['Journey / Environment', 'Fields confirmed to correctly require a value', 'Fields confirmed correctly optional', 'Result'];
    styleHeaderRow(headerRow);

    const rows = [
        {
            journey: 'LIVE Journey 1 — Initial load',
            correct: 'First name, Last name, Company, Industry, Email address, Country, Nature of enquiry',
            optional: 'Job title, Telephone number, Additional information',
            result: 'PASS — validation matches the asterisks shown on the page.',
        },
        {
            journey: 'LIVE Journey 2 — General/customer service enquiry',
            correct: 'First name, Last name, Company, Industry, Email address, Country, Nature of enquiry',
            optional: 'Job title, Telephone number, Additional information',
            result: 'PASS — no conditional fields introduced, same as Journey 1.',
        },
        {
            journey: 'LIVE Journey 3 — Product or service quotation request',
            correct: 'First name, Last name, Company, Industry, Email address, Country, Nature of enquiry, Quantity',
            optional: 'Job title, Telephone number, Product / service details, Material, Part number, Application details (STAMPS), Detailed quotation or basic estimation, Upload drawings / specifications, Additional information',
            result: '⚠ DEFECT — "Required delivery date" has no asterisk (shown as optional) but blocks submission with "The InputValue field is required." when left blank.',
            isDefect: true,
        },
        {
            journey: 'LIVE Journey 4 — Technical enquiry',
            correct: 'First name, Last name, Company, Industry, Email address, Country, Nature of enquiry',
            optional: 'Job title, Telephone number, Issue / problem, Product(s) currently in use, Application details (STAMPS), Upload drawings / images / notes, Additional information',
            result: 'PASS — validation matches the asterisks shown on the page.',
        },
        {
            journey: 'LIVE Journey 5 — I wish to become a supplier',
            correct: 'First name, Last name, Company, Industry, Email address, Country, Nature of enquiry',
            optional: 'Job title, Telephone number, Product / service you wish to supply, Local / regional / global supply, Additional information',
            result: 'PASS — validation matches the asterisks shown on the page.',
        },
        {
            journey: 'UAT — all states (initial load + all 3 dropdown options)',
            correct: 'Nature of enquiry, Full name, Email address, Company, Country, Industry, Additional information',
            optional: 'Job title, Telephone number',
            result: 'PASS — validation matches the asterisks shown on the page. No hidden/defective required fields found (consistent with there being no conditional fields to hide one in).',
        },
    ];

    let r = 5;
    for (const row of rows) {
        const excelRow = ws.getRow(r);
        excelRow.values = [row.journey, row.correct, row.optional, row.result];
        excelRow.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: 'top', wrapText: true }; });
        excelRow.getCell(1).font = { bold: true };
        if (row.isDefect) {
            excelRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.defectFill } }; });
            excelRow.getCell(4).font = { bold: true, color: { argb: COLORS.defectFont } };
        }
        excelRow.height = 55;
        r += 1;
    }

    r += 1;
    ws.mergeCells(`A${r}:D${r}`);
    const capRow = ws.getCell(`A${r}`);
    capRow.value = 'All journeys/environments also required a completed reCAPTCHA challenge before submission would proceed ("The response parameter is invalid or malformed." error otherwise). This is standard bot-prevention behaviour, not a field-validation defect, and is not asterisked because it is not a conventional form field.';
    capRow.font = { italic: true };
    capRow.alignment = { wrapText: true };
    ws.getRow(r).height = 30;
}

function buildCrossDeviceSheet(wb) {
    const ws = wb.addWorksheet('Cross-Device Compatibility', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = [
        { width: 42 },
        { width: 55 },
        { width: 55 },
        { width: 55 },
    ];

    ws.mergeCells('A1:D1');
    const title = ws.getCell('A1');
    title.value = 'Cross-Device Compatibility — Desktop vs Tablet (iPad Pro 11) vs Mobile (Pixel 7)';
    title.font = { bold: true, size: 14, color: { argb: COLORS.headerFill } };
    ws.getRow(1).height = 22;

    ws.mergeCells('A2:D2');
    ws.getCell('A2').value = 'Every Live journey and the UAT static form were re-checked on tablet and mobile viewports: same field-by-field capture, same "select a Nature of enquiry option" action, and the same empty-submission validation check used for desktop.';
    ws.getCell('A2').alignment = { wrapText: true };
    ws.getRow(2).height = 28;

    ws.mergeCells('A3:D3');
    const nativeNote = ws.getCell('A3');
    nativeNote.value = '✓ Good responsive behaviour found: the "Nature of enquiry"/"Industry"/"Country" dropdowns use a custom desktop widget (Selectric), but on both tablet and mobile it correctly disables itself (selectric-is-native) and hands off to the device\'s native picker — the standard, expected mobile pattern. This applies identically on Live and UAT.';
    nativeNote.font = { italic: true, bold: true };
    nativeNote.alignment = { wrapText: true };
    ws.getRow(3).height = 40;

    const headerRow = ws.getRow(5);
    headerRow.values = ['Journey / State', 'Tablet (iPad Pro 11) result', 'Mobile (Pixel 7) result', 'Notes'];
    styleHeaderRow(headerRow);

    const rows = [
        {
            name: 'LIVE — Initial load / General enquiry (9 base fields, no conditionals)',
            tablet: 'PASS — same 9 fields, same required flags as desktop.',
            mobile: 'PASS — same 9 fields, same required flags as desktop.',
            notes: 'Identical across all three viewports.',
        },
        {
            name: 'LIVE — Product or service quotation request (+8 conditional fields)',
            tablet: 'PASS — all 8 conditional fields appear correctly; "Quantity" required, others optional, matching desktop.',
            mobile: 'PASS — all 8 conditional fields appear correctly; "Quantity" required, others optional, matching desktop.',
            notes: '⚠ The "Required delivery date" validation defect reproduces identically on tablet and mobile — this is not a desktop-only issue.',
            isDefect: true,
        },
        {
            name: 'LIVE — Technical enquiry (+4 conditional fields)',
            tablet: 'PASS — all 4 conditional fields appear, all correctly optional.',
            mobile: 'PASS — all 4 conditional fields appear, all correctly optional.',
            notes: 'Identical across all three viewports, no anomalies.',
        },
        {
            name: 'LIVE — I wish to become a supplier (+2 conditional fields)',
            tablet: 'PASS — both conditional fields appear, both correctly optional.',
            mobile: 'PASS — both conditional fields appear, both correctly optional.',
            notes: 'Identical across all three viewports, no anomalies.',
        },
        {
            name: 'UAT — static form, all "Nature of enquiry" states',
            tablet: 'PASS — same 9 fields, same field order, same required flags as desktop.',
            mobile: 'PASS — same 9 fields, same field order, same required flags as desktop.',
            notes: 'Confirms the "no conditional logic on UAT" gap is consistent across devices, not just a desktop observation.',
        },
        {
            name: 'Cookie-consent banner (Cookiebot)',
            tablet: 'Displays as a full-width modal; "Allow all" dismisses it and the form behaves normally afterwards.',
            mobile: 'Displays as a full-screen modal; "Allow all" dismisses it and the form behaves normally afterwards.',
            notes: 'Not a defect — flagged only because the banner covers more of the screen on smaller viewports, so it must be dismissed before any field can be reached. Same on Live and UAT.',
        },
    ];

    let r = 6;
    for (const row of rows) {
        const excelRow = ws.getRow(r);
        excelRow.values = [row.name, row.tablet, row.mobile, row.notes];
        excelRow.eachCell((cell) => { cell.border = BORDER; cell.alignment = { vertical: 'top', wrapText: true }; });
        excelRow.getCell(1).font = { bold: true };
        if (row.isDefect) {
            excelRow.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.defectFill } }; });
            excelRow.getCell(4).font = { bold: true, color: { argb: COLORS.defectFont } };
        }
        excelRow.height = 55;
        r += 1;
    }

    r += 1;
    ws.mergeCells(`A${r}:D${r}`);
    const summaryCell = ws.getCell(`A${r}`);
    summaryCell.value = 'Overall: the form is cross-device compatible — field sets, conditional logic, and validation behave the same on desktop, tablet, and mobile for both environments. The one exception is the pre-existing "Required delivery date" validation defect (Live, Quotation journey only), which reproduces identically on all three viewports rather than being device-specific.';
    summaryCell.font = { bold: true };
    summaryCell.alignment = { wrapText: true };
    ws.getRow(r).height = 40;
}

build().catch((err) => { console.error(err); process.exit(1); });
