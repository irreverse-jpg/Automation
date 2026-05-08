const { test, expect } = require('@playwright/test');

const COOKIE_ACCEPT_SELECTOR = 'button[aria-label="Accept cookies"], button:has-text("Accept"), #onetrust-accept-btn-handler';
const SOCIAL_DOMAINS = ['twitter.com', 'linkedin.com', 'instagram.com'];
const LEGAL_FOOTER_LINKS = [
    { name: 'Legal and regulatory', href: '/en-gb/legal-and-regulatory' },
    { name: 'Pricing', href: '/en-gb/price-and-service-information' },
    { name: 'Cookies and privacy', href: '/en-gb/legal-and-regulatory/data-privacy' },
    { name: 'Accessibility', href: '/en-gb/accessibility' },
    { name: 'Attorney advertising', href: '/en-gb/legal-and-regulatory/attorney-advertising' },
];

async function acceptCookiesIfPresent(page) {
    const cookieButton = page.locator(COOKIE_ACCEPT_SELECTOR).first();
    if (await cookieButton.isVisible().catch(() => false)) {
        await cookieButton.click();
    }
}

async function getVisibleFooterLinks(page) {
    const footer = page.getByRole('contentinfo').first();
    return await footer.locator('a[href]').evaluateAll((links) => {
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const items = links
            .filter(isVisible)
            .map((link) => ({
                href: link.getAttribute('href'),
                target: link.getAttribute('target'),
                name: link.getAttribute('aria-label') || link.textContent.trim(),
            }))
            .filter((item) => !!item.href && !!item.name);

        const seen = new Set();
        return items.filter((item) => {
            const key = `${item.href}__${item.target || ''}__${item.name}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    });
}

async function openHomeFooter(page) {
    await page.goto('/');
    await page.waitForLoadState('load');
    await acceptCookiesIfPresent(page);

    const footer = page.getByRole('contentinfo').first();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    return footer;
}

function getComparableUrl(url) {
    const current = new URL(url);
    const host = current.hostname === 'x.com' ? 'twitter.com' : current.hostname;
    return `${current.protocol}//${host}${current.pathname}`;
}

function getComparableOrigin(url) {
    const current = new URL(url);
    const host = current.hostname === 'x.com' ? 'twitter.com' : current.hostname;
    return `${current.protocol}//${host}`;
}

async function clickFooterLinkAndVerify(page, baseURL, href, target, name, options = {}) {
    const footer = await openHomeFooter(page);
    const link = footer.getByRole('link', { name, exact: true }).first();
    await expect(link, `Footer link "${name}" (${href}) should be visible before clicking`).toBeVisible();

    const expectedUrl = new URL(href, baseURL).toString();
    const expectedComparableUrl = getComparableUrl(expectedUrl);
    const expectedComparableOrigin = getComparableOrigin(expectedUrl);
    const compareResult = options.compareHostOnly
        ? (url) => getComparableOrigin(url)
        : (url) => getComparableUrl(url);
    const expectedResult = options.compareHostOnly
        ? expectedComparableOrigin
        : expectedComparableUrl;

    if (target === '_blank') {
        const [popup] = await Promise.all([
            page.waitForEvent('popup', { timeout: 10000 }),
            link.click(),
        ]);

        await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
        await expect.poll(
            () => compareResult(popup.url()),
            {
                timeout: 10000,
                message: `Footer link "${name}" (${href}) opened an unexpected destination. Expected ${expectedResult}`,
            }
        ).toBe(expectedResult);
        await popup.close();
        return;
    }

    await link.click();
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await expect.poll(
        () => compareResult(page.url()),
        {
            timeout: 10000,
            message: `Footer link "${name}" (${href}) navigated to an unexpected destination. Expected ${expectedResult}`,
        }
    ).toBe(expectedResult);
}

test('Footer - Verify Footer is Present', async ({ page }) => {
    await test.step('Open homepage and scroll to footer', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await acceptCookiesIfPresent(page);

        const footer = page.getByRole('contentinfo').first();
        await footer.scrollIntoViewIfNeeded();
        await expect(footer, 'Footer region should be visible at the bottom of the page').toBeVisible();
        await expect(footer.getByRole('link', { name: 'About us' }).first(), 'Footer should expose the About us link').toBeVisible();
    });
}, 30000);

test('Footer - Verify Links', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await openHomeFooter(page);
    const footerLinks = await getVisibleFooterLinks(page);
    const legalFooterHrefs = new Set(LEGAL_FOOTER_LINKS.map((link) => link.href));
    const navigableLinks = footerLinks.filter(({ href }) => {
        return href &&
            !href.startsWith('#') &&
            !href.startsWith('javascript:') &&
            !href.startsWith('mailto:') &&
            !href.startsWith('tel:') &&
            !legalFooterHrefs.has(href) &&
            !SOCIAL_DOMAINS.some((domain) => href.includes(domain));
    });

    expect(navigableLinks.length).toBeGreaterThan(0);
    for (const { href, target, name } of navigableLinks) {
        await test.step(`Footer link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, target, name);
        });
    }
}, 30000);

test('Footer - Verify Social Links', async ({ page, baseURL }) => {
    test.setTimeout(180000);

    await openHomeFooter(page);
    const footerLinks = await getVisibleFooterLinks(page);
    const socialLinks = footerLinks.filter(({ href }) => {
        return href && SOCIAL_DOMAINS.some((domain) => href.includes(domain));
    });

    expect(socialLinks.length).toBeGreaterThan(0);
    for (const { href, target, name } of socialLinks) {
        await test.step(`Footer social link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, target, name, { compareHostOnly: true });
        });
    }
}, 30000);

test('Footer - Verify Legal Links', async ({ page, baseURL }) => {
    test.setTimeout(120000);

    for (const { href, name } of LEGAL_FOOTER_LINKS) {
        await test.step(`Footer legal link: ${name} -> ${href}`, async () => {
            await clickFooterLinkAndVerify(page, baseURL, href, undefined, name);
        });
    }
}, 30000);