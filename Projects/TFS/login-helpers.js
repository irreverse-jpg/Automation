// Shared constants/selectors for the login form, used by both global-setup.js (silent
// authentication before the suite) and 01-tfs.login.spec.js (which tests the login form
// itself). /portal/login works as a stable login route on BOTH environments - QA's domain
// root also happens to redirect "/" to "/login", but /portal/login was confirmed to serve
// the identical form there too (2026-08-26), so there is no need for a per-environment path.

const LOGIN_PATH = '/portal/login';
const DASHBOARD_PATH = '/portal/';
const AUTH_ERROR_MESSAGE = 'Authentication failed. Please check your credentials';

const SELECTORS = {
    emailInput: '#input-email',
    passwordInput: '#input-password',
    loginButton: 'button.login__button',
    forgotPasswordLink: 'a.login__forgot-password',
    logoutButton: 'button.logout',
};

async function submitLogin(page, email, password) {
    await page.fill(SELECTORS.emailInput, email);
    await page.fill(SELECTORS.passwordInput, password);
    await page.click(SELECTORS.loginButton);
}

// True for the Live environment (`https://www.thefuelstore.co.uk`), false for QA
// (`tfs-qa.hosted.positive.co.uk`) - added 2026-09-23 so any spec that submits a real form can
// gate the actual submission on environment, per Hector's explicit instruction that Live must
// never receive a completed, successful form submission (QA-only real submissions remain an
// accepted, documented side effect - see 09-tfs.additionalservices.spec.js). Checks for the QA
// hostname rather than the Live one, so a not-yet-anticipated third environment fails safe (is
// treated as Live, i.e. submission-blocking) rather than accidentally submitting for real.
function isLiveEnvironment(baseURL) {
    return !String(baseURL || '').includes('tfs-qa');
}

// NOTE (2026-09-02): a "log into a fresh, isolated context" helper used to live here, meant for
// tests that switch the selected account, so they wouldn't affect every other test sharing
// global-setup.js's storageState. It didn't work: confirmed by comparing cookies directly that
// TFS's login issues the exact SAME `.AspNetCore.Identity.Application`/`.AspNetCore.Session`
// cookie VALUE every time these credentials log in - even from a completely separate browser
// context with no shared storage. The account-selection "session" is really a single, canonical,
// per-USER server-side session, not a distinct per-login-session one, so two independently
// logged-in contexts for the same user are, from the server's point of view, the SAME session.
// There is no way to get a genuinely isolated session with only one set of credentials. See the
// shared-session note in 02-tfs.dashboard.spec.js for how this is handled instead (documentation
// + serial ordering, not isolation).

module.exports = { LOGIN_PATH, DASHBOARD_PATH, AUTH_ERROR_MESSAGE, SELECTORS, submitLogin, isLiveEnvironment };
