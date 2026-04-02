/**
 * auth.js — Shared authentication module for all frontend pages
 *
 * Stores JWT token + user info in localStorage (persistent across sessions).
 * Provides login UI, auth helpers, and automatic redirect on token expiry.
 */
const Auth = (() => {
    'use strict';

    const STORAGE_TOKEN = 'uebernahme_token';
    const STORAGE_USER = 'uebernahme_user';
    const BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '/api';

    // ── Token helpers ─────────────────────────────────────────

    function getToken() {
        return localStorage.getItem(STORAGE_TOKEN);
    }

    function getUser() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_USER));
        } catch {
            return null;
        }
    }

    function isLoggedIn() {
        const token = getToken();
        if (!token) return false;
        // Check if token is expired (decode without verify)
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.exp * 1000 > Date.now();
        } catch {
            return false;
        }
    }

    function hasRole(...roles) {
        const user = getUser();
        return user && roles.includes(user.role);
    }

    function logout() {
        localStorage.removeItem(STORAGE_TOKEN);
        localStorage.removeItem(STORAGE_USER);
        window.location.reload();
    }

    // ── Login API call ────────────────────────────────────────

    async function login(username, password) {
        const resp = await fetch(`${BASE}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await resp.json().catch(() => ({ error: 'Server error' }));
        if (!resp.ok) throw new Error(data.error || 'Login fehlgeschlagen');

        localStorage.setItem(STORAGE_TOKEN, data.token);
        localStorage.setItem(STORAGE_USER, JSON.stringify({
            username: data.username,
            role: data.role,
        }));
        return data;
    }

    // ── Auth header for fetch calls ───────────────────────────

    function authHeaders(extra = {}) {
        const token = getToken();
        return {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...extra,
        };
    }

    // ── Login Gate UI ─────────────────────────────────────────
    // Call requireLogin() at page start. If not logged in, shows
    // a login form overlay and resolves when authenticated.

    function requireLogin() {
        return new Promise((resolve) => {
            if (isLoggedIn()) {
                resolve(getUser());
                return;
            }

            // Clean up stale data
            localStorage.removeItem(STORAGE_TOKEN);
            localStorage.removeItem(STORAGE_USER);

            // Build login overlay
            const overlay = document.createElement('div');
            overlay.id = 'auth-gate';
            overlay.innerHTML = `
                <div style="position:fixed;inset:0;z-index:9999;background:#f8f8f6;display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;">
                    <div style="background:#fff;border-radius:12px;padding:2.5rem 2rem;width:100%;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;">
                        <div style="font-size:2rem;margin-bottom:.5rem">🔐</div>
                        <h2 style="margin:0 0 .25rem;font-size:1.1rem;color:#1a1a1a">Anmelden</h2>
                        <p style="margin:0 0 1.5rem;font-size:.85rem;color:#888">Benutzername & Passwort eingeben</p>
                        <input id="auth-username" type="text" placeholder="Benutzername" autocomplete="username" autofocus
                            style="width:100%;box-sizing:border-box;padding:.7rem 1rem;border:1.5px solid #ddd;border-radius:8px;font-size:1rem;outline:none;margin-bottom:.75rem;">
                        <input id="auth-password" type="password" placeholder="Passwort" autocomplete="current-password"
                            style="width:100%;box-sizing:border-box;padding:.7rem 1rem;border:1.5px solid #ddd;border-radius:8px;font-size:1rem;outline:none;margin-bottom:.75rem;">
                        <div id="auth-error" style="color:#c0392b;font-size:.8rem;min-height:1.2rem;margin-bottom:.5rem"></div>
                        <button id="auth-btn"
                            style="width:100%;padding:.75rem;background:#2c3e50;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer;">Anmelden</button>
                    </div>
                </div>`;
            document.body.prepend(overlay);

            const usernameInput = document.getElementById('auth-username');
            const passwordInput = document.getElementById('auth-password');
            const errorEl = document.getElementById('auth-error');
            const btn = document.getElementById('auth-btn');

            async function doLogin() {
                const u = usernameInput.value.trim();
                const p = passwordInput.value;
                if (!u || !p) {
                    errorEl.textContent = 'Bitte alle Felder ausfüllen';
                    return;
                }
                btn.disabled = true;
                btn.textContent = '…';
                errorEl.textContent = '';
                try {
                    await login(u, p);
                    overlay.style.opacity = '0';
                    overlay.style.transition = 'opacity .3s';
                    setTimeout(() => overlay.remove(), 300);
                    resolve(getUser());
                } catch (err) {
                    errorEl.textContent = err.message || 'Login fehlgeschlagen';
                    btn.disabled = false;
                    btn.textContent = 'Anmelden';
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }

            btn.addEventListener('click', doLogin);
            passwordInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doLogin();
            });
            usernameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') passwordInput.focus();
            });
            // Clear error on input
            [usernameInput, passwordInput].forEach(el => {
                el.addEventListener('input', () => { errorEl.textContent = ''; });
            });
        });
    }

    // ── Change password API call ────────────────────────────

    async function changePassword(currentPassword, newPassword) {
        const resp = await fetch(`${BASE}/admin/password`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await resp.json().catch(() => ({ error: 'Server error' }));
        if (!resp.ok) throw new Error(data.error || 'Passwort-Änderung fehlgeschlagen');
        return data;
    }

    // ── Password change modal ─────────────────────────────────

    function showPasswordModal() {
        // Remove existing modal if any
        const existing = document.getElementById('pw-change-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'pw-change-modal';
        overlay.innerHTML = `
            <div style="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;">
                <div style="background:#fff;border-radius:12px;padding:2rem;width:100%;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,.15);">
                    <h3 style="margin:0 0 1rem;font-size:1rem;">Passwort ändern</h3>
                    <input id="pw-cur" type="password" placeholder="Aktuelles Passwort" autocomplete="current-password"
                        style="width:100%;box-sizing:border-box;padding:.6rem .8rem;border:1.5px solid #ddd;border-radius:8px;font-size:.9rem;margin-bottom:.6rem;">
                    <input id="pw-new" type="password" placeholder="Neues Passwort (mind. 12 Zeichen)" autocomplete="new-password"
                        style="width:100%;box-sizing:border-box;padding:.6rem .8rem;border:1.5px solid #ddd;border-radius:8px;font-size:.9rem;margin-bottom:.6rem;">
                    <input id="pw-confirm" type="password" placeholder="Neues Passwort bestätigen" autocomplete="new-password"
                        style="width:100%;box-sizing:border-box;padding:.6rem .8rem;border:1.5px solid #ddd;border-radius:8px;font-size:.9rem;margin-bottom:.5rem;">
                    <div id="pw-change-error" style="color:#c0392b;font-size:.8rem;min-height:1.2rem;margin-bottom:.5rem"></div>
                    <div style="display:flex;gap:.5rem;justify-content:flex-end;">
                        <button id="pw-change-cancel" style="padding:.5rem 1rem;background:transparent;border:1px solid #d1d5db;border-radius:8px;font-size:.85rem;cursor:pointer;">Abbrechen</button>
                        <button id="pw-change-save" style="padding:.5rem 1rem;background:#2c3e50;color:#fff;border:none;border-radius:8px;font-size:.85rem;cursor:pointer;">Speichern</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const curEl = document.getElementById('pw-cur');
        const newEl = document.getElementById('pw-new');
        const confirmEl = document.getElementById('pw-confirm');
        const errEl = document.getElementById('pw-change-error');

        document.getElementById('pw-change-cancel').addEventListener('click', () => overlay.remove());
        document.getElementById('pw-change-save').addEventListener('click', async () => {
            errEl.textContent = '';
            const cur = curEl.value;
            const np = newEl.value;
            const nc = confirmEl.value;
            if (!cur || !np || !nc) { errEl.textContent = 'Bitte alle Felder ausfüllen'; return; }
            if (np.length < 12) { errEl.textContent = 'Mind. 12 Zeichen'; return; }
            if (np !== nc) { errEl.textContent = 'Passwörter stimmen nicht überein'; return; }
            try {
                await changePassword(cur, np);
                overlay.remove();
                alert('Passwort erfolgreich geändert.');
            } catch (e) {
                errEl.textContent = e.message;
            }
        });

        curEl.focus();
    }

    // ── Add logout button + password change to header ────────

    function addLogoutButton(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;
        const user = getUser();
        if (!user) return;

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:.5rem;';
        wrap.innerHTML = `
            <span style="font-size:.8rem;color:#9ca3af;" title="Rolle: ${user.role}">👤 ${user.username}</span>
            <button id="btn-pw-change" style="padding:.3rem .6rem;font-size:.75rem;background:transparent;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;color:#6b7280;" title="Passwort ändern">🔑</button>
            <button id="btn-logout" style="padding:.3rem .6rem;font-size:.75rem;background:transparent;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;color:#6b7280;">Logout</button>
        `;
        container.appendChild(wrap);
        document.getElementById('btn-logout').addEventListener('click', logout);
        document.getElementById('btn-pw-change').addEventListener('click', showPasswordModal);
    }

    return {
        getToken,
        getUser,
        isLoggedIn,
        hasRole,
        login,
        logout,
        changePassword,
        authHeaders,
        requireLogin,
        addLogoutButton,
        showPasswordModal,
    };
})();

window.Auth = Auth;
