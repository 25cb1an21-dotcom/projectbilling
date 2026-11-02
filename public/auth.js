// Accounts now live on the server (passwords are hashed there). This list only holds the usernames of the
// built-in accounts, so the owner dashboard can warn about duplicate usernames before saving.
const USERS = (window.RB_BUILTIN_USERS || []).map(username => ({ username }));

(() => {
    const AUTH_KEY = 'rb_auth_user';
    const SESSION_LENGTH = 15 * 60 * 1000;
    const WARNING_AT = 14 * 60 * 1000;
    let activityTimer = 0;
    let warningTimer = 0;
    let lastActivityWrite = 0;
    let inactivityStarted = false;

    function parseUser(raw) {
        try {
            const session = JSON.parse(raw || 'null');
            if (!session || !session.user || !session.token || !session.lastActivity) return null;
            if (Date.now() - session.lastActivity >= SESSION_LENGTH) return null;
            return session;
        } catch (error) {
            console.error('Could not read the login session.', error);
            return null;
        }
    }

    function getAuthLocation() {
        let session = null;
        let persistent = null;
        try {
            session = parseUser(sessionStorage.getItem(AUTH_KEY));
            persistent = parseUser(localStorage.getItem(AUTH_KEY));
        } catch (error) {
            console.error('Could not access saved login sessions.', error);
        }
        return session ? { store: sessionStorage, value: session } :
            persistent ? { store: localStorage, value: persistent } : null;
    }

    function clearAuth() {
        try {
            sessionStorage.removeItem(AUTH_KEY);
            localStorage.removeItem(AUTH_KEY);
            sessionStorage.removeItem('rb_adm');
        } catch (error) {
            console.error('Could not clear the login session.', error);
        }
    }

    function userFromRecord(user) {
        return {
            username: user.username,
            role: user.role,
            name: user.name || user.displayName || user.username
        };
    }

    async function login(username, password, role, remember) {
        let result;
        try {
            result = await window.RBApi.request('POST', '/api/auth/login', {
                username: String(username).trim(),
                password,
                role
            });
        } catch (error) {
            return { ok: false, message: error.network ? error.message : error.message || 'Sign-in failed.' };
        }

        const session = JSON.stringify({
            user: userFromRecord(result.user),
            token: result.token,
            lastActivity: Date.now()
        });
        try {
            clearAuth();
            (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, session);
            if (result.user.role === 'owner') sessionStorage.setItem('rb_adm', '1');
        } catch (error) {
            console.error('Could not save the login session.', error);
            return { ok: false, message: 'Could not save your sign-in. Check that browser storage is allowed.' };
        }
        window.location.href = `${result.user.role}.html`;
        return { ok: true };
    }

    function getCurrentUser() {
        const location = getAuthLocation();
        return location ? location.value.user : null;
    }

    function logout() {
        clearTimeout(activityTimer);
        clearTimeout(warningTimer);
        clearAuth();
        window.location.href = 'login.html';
    }

    function requireRole(allowedRoles) {
        const user = getCurrentUser();
        if (!user || !allowedRoles.includes(user.role)) {
            clearAuth();
            window.location.replace(`login.html?reason=${user ? 'role' : 'session'}`);
            return null;
        }
        startInactivityTimer();
        return user;
    }

    function closeWarning() {
        const warning = document.querySelector('#session-warning');
        if (warning) warning.remove();
    }

    function showWarning() {
        if (!document.body || document.querySelector('#session-warning')) return;
        const overlay = document.createElement('div');
        overlay.id = 'session-warning';
        overlay.className = 'session-warning-overlay';
        overlay.innerHTML = '<section class="session-warning-card" role="alertdialog" aria-modal="true" aria-labelledby="session-warning-title" aria-describedby="session-warning-message"><h2 id="session-warning-title">Still there?</h2><p id="session-warning-message">You will be signed out in 1 minute due to inactivity.</p><button type="button" class="session-continue">Stay signed in</button><button type="button" class="session-signout">Sign out now</button></section>';
        document.body.append(overlay);
        overlay.querySelector('.session-continue').addEventListener('click', () => {
            closeWarning();
            recordActivity();
        });
        overlay.querySelector('.session-signout').addEventListener('click', logout);
        overlay.querySelector('.session-continue').focus();
    }

    function scheduleInactivity() {
        clearTimeout(activityTimer);
        clearTimeout(warningTimer);
        warningTimer = window.setTimeout(showWarning, WARNING_AT);
        activityTimer = window.setTimeout(logout, SESSION_LENGTH);
    }

    function recordActivity(event) {
        if (event?.target?.closest?.('#session-warning')) return;
        const location = getAuthLocation();
        if (!location) return;
        closeWarning();
        if (Date.now() - lastActivityWrite > 30000) {
            try {
                location.store.setItem(AUTH_KEY, JSON.stringify({
                    user: location.value.user,
                    token: location.value.token,
                    lastActivity: Date.now()
                }));
                lastActivityWrite = Date.now();
            } catch (error) {
                console.error('Could not refresh the login session.', error);
            }
        }
        scheduleInactivity();
    }

    function startInactivityTimer() {
        if (inactivityStarted) return;
        inactivityStarted = true;
        ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(eventName => {
            document.addEventListener(eventName, recordActivity, { passive: true });
        });
        scheduleInactivity();
    }

    window.login = login;
    window.logout = logout;
    window.getCurrentUser = getCurrentUser;
    window.requireRole = requireRole;
    window.addEventListener('storage', event => {
        if (event.key === AUTH_KEY && !getCurrentUser()) logout();
    });

    document.addEventListener('DOMContentLoaded', () => {
        const reason = new URLSearchParams(location.search).get('reason');
        const error = document.querySelector('#login-error');
        if (error && reason) {
            error.textContent = reason === 'role'
                ? 'Your account does not have access to that dashboard. Please sign in with the correct role.'
                : 'Your session expired. Please sign in again.';
            error.hidden = false;
        }
        const form = document.querySelector('#role-login-form');
        if (!form) return;

        const toggle = document.querySelector('#toggle-password');
        const passwordInput = document.querySelector('#password');
        toggle.addEventListener('click', () => {
            const visible = passwordInput.type === 'password';
            passwordInput.type = visible ? 'text' : 'password';
            toggle.textContent = visible ? 'Hide' : 'Show';
            toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
            toggle.setAttribute('aria-pressed', String(visible));
        });

        form.addEventListener('submit', async event => {
            event.preventDefault();
            const values = new FormData(form);
            const error = document.querySelector('#login-error');
            const submit = form.querySelector('[type="submit"]');
            error.hidden = true;
            error.classList.remove('is-error');
            if (submit) submit.disabled = true;
            const result = await login(
                values.get('username'),
                values.get('password'),
                values.get('role'),
                values.get('remember') === 'on'
            );
            if (!result.ok) {
                if (submit) submit.disabled = false;
                error.textContent = result.message;
                error.hidden = false;
                error.classList.add('is-error');
                document.querySelector('#username').focus();
            }
        });
    });
})();
