/**
 * api.js — Backend API abstraction layer
 * All fetch calls go through here. Falls back gracefully if backend unavailable.
 * Uses Auth.getToken() for JWT authorization on all requests.
 */

const API = (() => {
    const BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '/api';

    function getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (window.Auth && Auth.getToken()) {
            headers.Authorization = `Bearer ${Auth.getToken()}`;
        }
        return headers;
    }

    async function request(method, path, body) {
        const opts = {
            method,
            headers: getAuthHeaders(),
        };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const resp = await fetch(`${BASE}${path}`, opts);

        // Auto-logout on 401
        if (resp.status === 401 && window.Auth) {
            Auth.logout();
            return;
        }

        const data = await resp.json().catch(() => ({ error: 'Invalid response' }));
        if (!resp.ok) throw Object.assign(new Error(data.error || 'API Error'), { status: resp.status, data });
        return data;
    }

    /* ── Analysis Sessions ─────────────────────────────────────────── */

    function createSession(sessionData) {
        return request('POST', '/analysis', sessionData);
    }

    function getSession(sessionId) {
        return request('GET', `/analysis/${sessionId}`);
    }

    function updateSession(sessionId, stepData) {
        return request('PATCH', `/analysis/${sessionId}`, stepData);
    }

    function calculateValuation(sessionId) {
        return request('POST', `/analysis/${sessionId}/calculate`);
    }

    /* ── Knowledge Base ────────────────────────────────────────────── */

    function getKnowledgeEntry(slug) {
        return request('GET', `/knowledge/${slug}`);
    }

    function listKnowledge(params) {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        return request('GET', `/knowledge${qs}`);
    }

    /* ── Checklists ────────────────────────────────────────────────── */

    function getChecklist(params) {
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        return request('GET', `/checklist${qs}`);
    }

    /* ── Contract Drafts ───────────────────────────────────────────── */

    function listDrafts() {
        return request('GET', '/contract/drafts');
    }

    function deleteDraftBackend(draftId) {
        return request('DELETE', `/contract/draft/${encodeURIComponent(draftId)}`);
    }

    /* ── Admin ─────────────────────────────────────────────────────── */

    function adminLogin(username, password) {
        return request('POST', '/admin/login', { username, password });
    }

    function adminGetKnowledge(token, params) {
        return authRequest(token, 'GET', '/admin/knowledge', null, params);
    }

    function adminCreateKnowledge(token, entry) {
        return authRequest(token, 'POST', '/admin/knowledge', entry);
    }

    function adminUpdateKnowledge(token, id, entry) {
        return authRequest(token, 'PUT', `/admin/knowledge/${id}`, entry);
    }

    function adminDeleteKnowledge(token, id) {
        return authRequest(token, 'DELETE', `/admin/knowledge/${id}`);
    }

    function adminGetPending(token) {
        return authRequest(token, 'GET', '/admin/pending');
    }

    function adminApprovePending(token, id) {
        return authRequest(token, 'POST', `/admin/pending/${id}/approve`);
    }

    function adminRejectPending(token, id) {
        return authRequest(token, 'DELETE', `/admin/pending/${id}/reject`);
    }

    function adminTriggerUpdate(token) {
        return authRequest(token, 'POST', '/admin/trigger-update');
    }

    function adminGetLogs(token) {
        return authRequest(token, 'GET', '/admin/scrape-logs');
    }

    function adminGetUsers(token) {
        return authRequest(token, 'GET', '/admin/users');
    }

    function adminCreateUser(token, userData) {
        return authRequest(token, 'POST', '/admin/users', userData);
    }

    function adminUpdateUser(token, id, userData) {
        return authRequest(token, 'PATCH', `/admin/users/${id}`, userData);
    }

    async function authRequest(token, method, path, body, params) {
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
        };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const qs = params ? '?' + new URLSearchParams(params).toString() : '';
        const resp = await fetch(`${BASE}${path}${qs}`, opts);
        const data = await resp.json().catch(() => ({ error: 'Invalid response' }));
        if (!resp.ok) throw Object.assign(new Error(data.error || 'API Error'), { status: resp.status, data });
        return data;
    }

    return {
        createSession,
        getSession,
        updateSession,
        calculateValuation,
        getKnowledgeEntry,
        listKnowledge,
        getChecklist,
        listDrafts,
        deleteDraftBackend,
        adminLogin,
        adminGetKnowledge,
        adminCreateKnowledge,
        adminUpdateKnowledge,
        adminDeleteKnowledge,
        adminGetPending,
        adminApprovePending,
        adminRejectPending,
        adminTriggerUpdate,
        adminGetLogs,
        adminGetUsers,
        adminCreateUser,
        adminUpdateUser,
    };
})();

window.API = API;
