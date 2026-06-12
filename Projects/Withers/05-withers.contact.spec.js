const { test, expect } = require('@playwright/test');
const { getCurrentSubmissionNumber, incrementSubmissionNumber } = require('./submissionCounter');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const COOKIE_OVERLAY_SELECTOR = '#onetrust-consent-sdk .onetrust-pc-dark-filter, #onetrust-pc-sdk';
const CONTACT_FORM_COUNTER_KEY = 'contact-us';
const REGION_OPTIONS = ['APAC', 'UK', 'USA'];
const COUNTRY_OPTIONS = ['Singapore', 'United Kingdom', 'United States'];
const ENQUIRY_SEEDS = [
    'Lorem ipsum dolor sit amet consectetur',
    'Lorem ipsum dolor sit amet adipiscing',
    'Lorem ipsum dolor sit amet facilisis',
    'Lorem ipsum dolor sit amet vivamus'
];

function getSubmitButton(page) {
    return page.locator('input[type="submit"][value="Submit"], button:has-text("Submit")').first();
}

async function submitContactForm(page) {
    let submitButton = getSubmitButton(page);
    await expect(submitButton, 'The contact form should expose the Submit button').toBeVisible();

    try {
        await clickWithCookieGuard(page, submitButton);
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isTransientSubmitError = message.includes('not attached to the dom') || message.includes('element is not stable');

        if (!isTransientSubmitError) {
            throw error;
        }

        submitButton = getSubmitButton(page);
        await expect(submitButton, 'The contact form should still expose the Submit button after the page settles').toBeVisible();
        await clickWithCookieGuard(page, submitButton);
    }
}

function numberToWord(n) {
    const words = [
        'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'
    ];
    return n < words.length ? words[n] : `Num${n}`;
}

function buildUniqueSubmissionData(submissionNumber) {
    const submissionWord = numberToWord(submissionNumber);
    const region = REGION_OPTIONS[(submissionNumber - 1) % REGION_OPTIONS.length];
    const country = COUNTRY_OPTIONS[(submissionNumber - 1) % COUNTRY_OPTIONS.length];
    const enquirySeed = ENQUIRY_SEEDS[(submissionNumber - 1) % ENQUIRY_SEEDS.length];
    const paddedPhoneSuffix = String(100000000 + submissionNumber).slice(-9);

    return {
        firstName: `Withers${submissionWord}`,
        lastName: `Contact${submissionWord}`,
        email: `withers.contact.${submissionNumber}@example.com`,
        phoneNumber: `07${paddedPhoneSuffix}`,
        country,
        region,
        enquiry: `${enquirySeed} submission ${submissionWord} entry`
    };
}

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }

    await dismissCookieOverlayIfPresent(page);
}

async function dismissCookieOverlayIfPresent(page) {
    const cookieOverlay = page.locator(COOKIE_OVERLAY_SELECTOR).first();
    const acceptAllButton = page.locator('#onetrust-accept-btn-handler, button:has-text("Accept all cookies")').first();
    const closeButton = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button[aria-label="Close"]').first();

    const overlayVisible = await cookieOverlay.isVisible().catch(() => false);
    const acceptVisible = await acceptAllButton.isVisible().catch(() => false);
    const closeVisible = await closeButton.isVisible().catch(() => false);

    if (!overlayVisible && !acceptVisible && !closeVisible) {
        return;
    }

    if (acceptVisible) {
        await acceptAllButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click({ timeout: 2000 }).catch(() => { });
    }

    if (await cookieOverlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => { });
    }
}

async function clickWithCookieGuard(page, locator) {
    await dismissCookieOverlayIfPresent(page);

    try {
        await locator.click();
    } catch (error) {
        const message = String(error || '').toLowerCase();
        const isCookieInterception = message.includes('intercepts pointer events') || message.includes('onetrust');

        if (!isCookieInterception) {
            throw error;
        }

        await dismissCookieOverlayIfPresent(page);
        await locator.click();
    }
}

test('Contact Form - Verify it is Present', async ({ page }) => {
    await test.step('Open the contact page', async () => {
        await page.goto('/contact-us', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expect(page, 'The contact form test should land on the localized contact page').toHaveURL(/\/contact-us$/);
        await expect(page, 'The contact page should load the expected title').toHaveTitle(/Contact us/i);
    });

    await test.step('Verify the contact form content and key fields', async () => {
        await expect(page.getByText(/CONTACT US/i).first(), 'The contact page should show the contact section heading').toBeVisible();
        await expect(page.getByText(/Use the form below to contact us/i), 'The contact page should explain that enquiries are submitted through the form').toBeVisible();

        await expect(page.getByLabel(/First name/i), 'The contact form should expose a First name field').toBeVisible();
        await expect(page.getByLabel(/Last name/i), 'The contact form should expose a Last name field').toBeVisible();
        await expect(page.getByLabel(/Email address/i), 'The contact form should expose an Email address field').toBeVisible();
        await expect(page.getByLabel(/Country/i), 'The contact form should expose a Country field').toBeVisible();
        await expect(page.getByLabel(/Enquiry/i), 'The contact form should expose an Enquiry field').toBeVisible();
    });
}, 30000);

test('Contact Form - Validate When All Fields Empty', async ({ page }) => {
    await test.step('Open the contact page', async () => {
        await page.goto('/contact-us', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expect(page, 'The contact form test should land on the localized contact page').toHaveURL(/\/contact-us$/);
        await expect(page, 'The contact page should load the expected title').toHaveTitle(/Contact us/i);
    });

    await test.step('Submit the form with all required fields empty', async () => {
        await submitContactForm(page);
    });

    await test.step('Verify the form is not submitted and required-field validation appears', async () => {
        await expect(page, 'The empty form should remain on the contact page').toHaveURL(/\/contact-us$/);

        const validationMessage = page.locator('span').filter({ hasText: 'Please enter a value.' }).nth(4);
        await expect(validationMessage, 'Submitting the empty form should surface the Please enter a value. validation message').toBeVisible();
    });
});

test('Contact Form - Validate Partial Submission', async ({ page }) => {
    await test.step('Open the contact page', async () => {
        await page.goto('/contact-us', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expect(page, 'The contact form test should land on the localized contact page').toHaveURL(/\/contact-us$/);
        await expect(page, 'The contact page should load the expected title').toHaveTitle(/Contact us/i);
    });

    await test.step('Fill only the email field and submit the form', async () => {
        const emailField = page.getByLabel(/Email address/i);
        await emailField.fill('test@example.com');

        await submitContactForm(page);
    });

    await test.step('Verify the form stays on the contact page and shows missing-field validation', async () => {
        await expect(page, 'The partially completed form should remain on the contact page').toHaveURL(/\/contact-us$/);

        const validationMessages = page.locator('span').filter({ hasText: 'Please enter a value.' });
        await expect(validationMessages.first(), 'Submitting the partially completed form should show at least one Please enter a value. validation message').toBeVisible();
    });
});

test('Contact Form - Validate Successful Submission', async ({ page }) => {
    const submissionNumber = getCurrentSubmissionNumber(CONTACT_FORM_COUNTER_KEY);
    const submission = buildUniqueSubmissionData(submissionNumber);

    await test.step('Open the contact page', async () => {
        await page.goto('/contact-us', { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await expect(page, 'The contact form test should land on the localized contact page').toHaveURL(/\/contact-us$/);
        await expect(page, 'The contact page should load the expected title').toHaveTitle(/Contact us/i);
    });

    await test.step('Fill the contact form with a unique successful-submission dataset', async () => {
        await page.getByLabel(/First name/i).fill(submission.firstName);
        await page.getByLabel(/Last name/i).fill(submission.lastName);
        await page.getByLabel(/Email address/i).fill(submission.email);
        await page.getByLabel(/Phone number/i).fill(submission.phoneNumber);
        await page.getByLabel(/Country/i).fill(submission.country);
        await page.locator('select[name*="Region"]').selectOption(submission.region);
        await page.getByLabel(/Enquiry/i).fill(submission.enquiry);
    });

    await test.step('Submit the completed contact form', async () => {
        await submitContactForm(page);
    });

    await test.step('Verify the submission succeeds and advance the submission counter', async () => {
        await expect(page.getByText(/thank you|thanks|we\'ll be in touch|received/i).first(), 'A successful contact form submission should show a success acknowledgement').toBeVisible();
        incrementSubmissionNumber(CONTACT_FORM_COUNTER_KEY);
    });
});
