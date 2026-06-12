const { test, expect } = require('@playwright/test');

const formPath = '/home/mortgages/mortgage-enquiry-form';

// Cookie Selector (If there is one)
const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';

const { getCurrentSubmissionNumber, incrementSubmissionNumber } = require('./submissionCounter');

function numberToWord(n) {
    const words = [
        'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'
    ];
    return n < words.length ? words[n] : `Num${n}`;
}

async function acceptCookiesIfPresent(page, options = {}) {
    const { silent = false } = options;
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR);
    if (await cookieButton.first().isVisible().catch(() => false)) {
        if (!silent) {
            console.log('Cookie button found, clicking...');
        }
        await cookieButton.first().click();
    } else if (!silent) {
        console.log('Cookie button not found or not visible.');
    }
}

async function isRecaptchaSolved(page) {
    const tokenHasValue = await page.evaluate(() => {
        const token = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
        return Boolean(token && token.value && token.value.trim().length > 0);
    });

    if (tokenHasValue) {
        return true;
    }

    const recaptchaAnchor = page.frameLocator('iframe[title*="reCAPTCHA" i]').locator('#recaptcha-anchor').first();
    const anchorVisible = await recaptchaAnchor.isVisible().catch(() => false);

    if (!anchorVisible) {
        return false;
    }

    const ariaChecked = await recaptchaAnchor.getAttribute('aria-checked').catch(() => null);
    return ariaChecked === 'true';
}

async function waitForManualRecaptchaAndEnabledSubmit(page, timeoutMs = 300000) {
    const submitBtn = page.getByRole('button', { name: 'Submit your callback details' });
    await expect(submitBtn).toBeVisible({ timeout: 30000 });
    await submitBtn.scrollIntoViewIfNeeded().catch(() => { });
    await page.bringToFront().catch(() => { });

    console.log('Manual action required: please tick the reCAPTCHA checkbox in the browser. Test will continue automatically once solved and submit is enabled.');

    const startedAt = Date.now();
    let loopCount = 0;
    while (Date.now() - startedAt < timeoutMs) {
        if (loopCount % 5 === 0) {
            await acceptCookiesIfPresent(page, { silent: true });
        }
        loopCount += 1;

        const [recaptchaSolved, submitEnabled] = await Promise.all([
            isRecaptchaSolved(page),
            submitBtn.isEnabled().catch(() => false),
        ]);

        if (recaptchaSolved && submitEnabled) {
            console.log('reCAPTCHA solved and submit button enabled. Continuing submission flow.');
            return;
        }

        await page.waitForTimeout(400);
    }

    throw new Error('Timed out waiting for manual reCAPTCHA completion and enabled submit button.');
}

async function getVisibleValidationMessages(page) {
    return await page.evaluate(() => {
        const isVisible = (el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
        };

        const regex = /(is required\.|Please tick the reCAPTCHA checkbox\.)/i;
        const candidates = Array.from(document.querySelectorAll('a, p, span, li, div'));

        const messages = candidates
            .filter(el => isVisible(el))
            .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(text => text.length > 0 && text.length < 180 && regex.test(text));

        return Array.from(new Set(messages));
    });
}

async function submitAndCollectValidationMessages(page) {
    const submitBtn = page.getByRole('button', { name: 'Submit your callback details' });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();
    await submitBtn.scrollIntoViewIfNeeded();

    for (let attempt = 0; attempt < 3; attempt++) {
        await submitBtn.click({ force: true });
        await page.waitForTimeout(400);

        let messages = await getVisibleValidationMessages(page);
        if (messages.length > 0) return messages;

        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);

        messages = await getVisibleValidationMessages(page);
        if (messages.length > 0) return messages;

        await page.evaluate(() => {
            const submit = Array.from(document.querySelectorAll('button'))
                .find(b => /submit your callback details/i.test((b.textContent || '').trim()));
            submit?.click();

            const form = submit?.closest('form') || document.querySelector('form');
            if (form) {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
        });

        await page.waitForTimeout(400);
        messages = await getVisibleValidationMessages(page);
        if (messages.length > 0) return messages;
    }

    return [];
}

test('Forms - Verify Mortgage Enquiry Form is Present', async ({ page }) => {
    await test.step('Open the mortgage enquiry form', async () => {
        await page.goto(formPath, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Verify the key mortgage enquiry form fields', async () => {
        await expect(page.getByRole('heading', { name: 'Mortgage enquiry form', level: 2 }), 'Mortgage enquiry form page should show its main heading').toBeVisible();
        await expect(page.getByLabel('Last name'), 'Mortgage enquiry form should expose the Last name field').toBeVisible();
    });
});

test('Forms - Validate When All Fields Empty', async ({ page }) => {
    await test.step('Open a clean mortgage enquiry form session', async () => {
        await page.goto(formPath, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
        await page.evaluate(() => localStorage.clear());
        await page.evaluate(() => sessionStorage.clear());
        await acceptCookiesIfPresent(page);
    });

    const messages = await test.step('Submit the empty mortgage enquiry form', async () => {
        return await submitAndCollectValidationMessages(page);
    });

    await test.step('Verify the empty submission is blocked', async () => {
        const submissionBlocked = await page.evaluate(() => {
            const form = document.querySelector('form');
            const invalidCount = document.querySelectorAll('input:invalid, select:invalid, textarea:invalid').length;
            if (invalidCount > 0) return true;
            if (form && typeof form.reportValidity === 'function') {
                return form.reportValidity() === false;
            }
            return false;
        });

        expect(submissionBlocked || messages.length > 0, 'Submitting an empty form should either be blocked by browser validity or surface validation messages').toBe(true);
        await expect(page, 'Empty form submission should not reach the success page').not.toHaveURL(/successful-form-submission/);
    });
});

test('Forms - Validate Partial Submission', async ({ page }) => {
    await test.step('Open the mortgage enquiry form', async () => {
        await page.goto(formPath, { waitUntil: 'domcontentloaded' });
        await acceptCookiesIfPresent(page);
    });

    await test.step('Fill a partial mortgage enquiry submission', async () => {
        await page.getByLabel('First name').fill('John');
        await page.getByLabel('Last name').fill('Doe');
        await page.getByLabel('First line of your address').fill('123 Main St');
        await page.getByLabel('Contact number').fill('07123456789');
    });

    const messages = await test.step('Submit the partial mortgage enquiry form', async () => {
        return await submitAndCollectValidationMessages(page);
    });

    await test.step('Verify the partial submission is blocked and values remain', async () => {
        const submissionBlocked = await page.evaluate(() => {
            const form = document.querySelector('form');
            const invalidCount = document.querySelectorAll('input:invalid, select:invalid, textarea:invalid').length;
            if (invalidCount > 0) return true;
            if (form && typeof form.reportValidity === 'function') {
                return form.reportValidity() === false;
            }
            return false;
        });

        expect(submissionBlocked || messages.length > 0, 'Submitting a partial form should either be blocked by browser validity or surface validation messages').toBe(true);
        await expect(page, 'Partial submission should remain on the mortgage enquiry form').toHaveURL(/\/home\/mortgages\/mortgage-enquiry-form/);
        await expect(page, 'Partial submission should not reach the success page').not.toHaveURL(/successful-form-submission/);

        await expect(page.getByLabel('First name'), 'First name should persist after a blocked submission').toHaveValue('John');
        await expect(page.getByLabel('Last name'), 'Last name should persist after a blocked submission').toHaveValue('Doe');
        await expect(page.getByLabel('First line of your address'), 'Address should persist after a blocked submission').toHaveValue('123 Main St');
        await expect(page.getByLabel('Contact number'), 'Contact number should persist after a blocked submission').toHaveValue('07123456789');
    });
});

test('Forms - Validate Successful Submission', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    const submissionNum = getCurrentSubmissionNumber();
    const submissionWord = numberToWord(submissionNum);

    await page.goto(formPath);
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);

    const titleOptions = ['Mr', 'Mrs', 'Miss', 'Ms', 'Mx'];
    const femaleTitles = ['Mrs', 'Miss', 'Ms'];

    let title, firstName, lastName;

    if (submissionNum % 5 === 4) {
        title = 'Mx';
        firstName = submissionNum % 2 === 0 ? `John${submissionWord}` : `Jane${submissionWord}`;
        lastName = `Doe${submissionWord}`;
    } else if (submissionNum % 2 === 0) {
        title = 'Mr';
        firstName = `John${submissionWord}`;
        lastName = `Doe${submissionWord}`;
    } else {
        const femaleTitle = femaleTitles[((submissionNum - 1) / 2) % femaleTitles.length];
        title = femaleTitle;
        firstName = `Jane${submissionWord}`;
        lastName = `Doe${submissionWord}`;
    }

    const residenceOptions = ['United Kingdom', 'Other'];
    const propertyLocationOptions = ['England', 'Wales'];
    const mortgageTypeOptions = ['Residential', 'Buy to Let', 'Holiday Let'];
    const callBackTimeOptions = [
        'Weekday: 9:30am - 11am',
        'Weekday: 11am - 2pm',
        'Weekday: 2pm - 5pm'
    ];
    const callBackTimePatterns = [
        /weekday\s*:\s*9[:.]?30am\s*-\s*11am/i,
        /weekday\s*:\s*11am\s*-\s*2pm/i,
        /weekday\s*:\s*2pm\s*-\s*5pm/i,
    ];

    const residence = residenceOptions[submissionNum % residenceOptions.length];
    const propertyLocation = propertyLocationOptions[submissionNum % propertyLocationOptions.length];
    const mortgageType = mortgageTypeOptions[submissionNum % mortgageTypeOptions.length];
    const enquiryDetails = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim.';

    await page.getByLabel('Title').selectOption({ label: title });
    await page.getByLabel('First name').fill(firstName);
    await page.getByLabel('Last name').fill(lastName);
    await page.getByLabel('Date of birth').fill('01/01/1990');
    await page.getByLabel(residence).check();
    await page.getByLabel('First line of your address').fill(`123 Main St Apt ${submissionWord}`);
    await page.getByLabel('Contact number').fill(`07123${String(submissionNum).padStart(6, '0')}`);
    await page.getByLabel('Email address', { exact: true }).fill(`${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`);
    await page.getByLabel('Re-confirm email address', { exact: true }).fill(`${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`);
    await page.getByLabel(propertyLocation).check();
    await page.getByLabel(mortgageType).check();
    await page.getByLabel('How much is the property value?').fill('300000');
    await page.getByLabel('How much is your deposit?').fill('50000');
    await page.getByLabel('Tell us more').fill(enquiryDetails);

    const numToSelect = (submissionNum % 3) + 1;
    let callbackSelectionCount = 0;
    for (let i = 0; i < numToSelect; i++) {
        let selected = false;

        const exactSlot = page.getByLabel(callBackTimeOptions[i], { exact: true });
        if (await exactSlot.isVisible().catch(() => false)) {
            await exactSlot.check();
            selected = true;
            callbackSelectionCount += 1;
        }

        if (!selected) {
            const fallbackSlot = page.getByRole('checkbox', { name: callBackTimePatterns[i] }).first();
            if (await fallbackSlot.isVisible().catch(() => false)) {
                await fallbackSlot.check();
                selected = true;
                callbackSelectionCount += 1;
            }
        }
    }

    if (callbackSelectionCount === 0) {
        console.log('Callback time checkboxes are not present in this environment. Continuing without selecting time preferences.');
    }

    await waitForManualRecaptchaAndEnabledSubmit(page);

    const submitBtn = page.getByRole('button', { name: 'Submit your callback details' });
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();

    await expect(page.getByText('Thank you for your enquiry')).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/\/home\/mortgages\/mortgage-enquiry-form\/successful-form-submission$/, { timeout: 30000 });

    incrementSubmissionNumber();
});

