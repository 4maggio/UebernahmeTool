/**
 * availabilityApp.js — Name Availability Checker
 * Checks domain availability, social media handles, and provides trademark search links.
 */

(function () {
    'use strict';

    const nameInput = document.getElementById('avail-name');
    const checkBtn = document.getElementById('avail-btn');
    const resultsDiv = document.getElementById('avail-results');
    const loadingDiv = document.getElementById('avail-loading');
    const errorDiv = document.getElementById('avail-error');
    const domainList = document.getElementById('domain-results');
    const socialList = document.getElementById('social-results');
    const trademarkList = document.getElementById('trademark-results');

    // ── TLD chip toggle ──────────────────────────────────────────
    document.querySelectorAll('.tld-chip input').forEach(cb => {
        cb.addEventListener('change', () => {
            cb.closest('.tld-chip').classList.toggle('checked', cb.checked);
        });
        // Init state
        if (cb.checked) cb.closest('.tld-chip').classList.add('checked');
    });

    // ── Gather selected TLDs ─────────────────────────────────────
    function getSelectedTlds() {
        return Array.from(document.querySelectorAll('.tld-chip input:checked'))
            .map(cb => cb.value);
    }

    // ── Badge HTML ───────────────────────────────────────────────
    function badgeHtml(status) {
        const labels = { available: '✓ Frei', taken: '✗ Belegt', unknown: '? Unbekannt' };
        return `<span class="badge ${status}">${labels[status] || labels.unknown}</span>`;
    }

    // ── Render domain results ────────────────────────────────────
    function renderDomains(domains) {
        domainList.innerHTML = domains.map(d => `
            <li class="result-item">
                <span class="name">${escHtml(d.domain)}</span>
                ${badgeHtml(d.status)}
                <a href="https://www.whois.com/whois/${encodeURIComponent(d.domain)}" target="_blank" rel="noopener">WHOIS</a>
            </li>
        `).join('');
    }

    // ── Render social results ────────────────────────────────────
    const SOCIAL_ICONS = {
        github: '🐙', youtube: '▶️', instagram: '📷',
        tiktok: '🎵', x: '𝕏', linkedin: '💼', facebook: '📘',
    };

    function renderSocial(social) {
        socialList.innerHTML = social.map(s => `
            <li class="result-item">
                <span class="name">${SOCIAL_ICONS[s.id] || '🔗'} ${escHtml(s.name)}</span>
                ${badgeHtml(s.status)}
                <a href="${escHtml(s.url)}" target="_blank" rel="noopener">${s.status === 'taken' ? 'Profil öffnen' : 'Prüfen'} →</a>
            </li>
        `).join('');
    }

    // ── Render trademark links ───────────────────────────────────
    function renderTrademarks(trademarks) {
        trademarkList.innerHTML = trademarks.map(t => `
            <a class="trademark-link" href="${escHtml(t.url)}" target="_blank" rel="noopener">
                <div>
                    <div class="tm-name">🔎 ${escHtml(t.name)}</div>
                    <div class="tm-desc">${escHtml(t.description)}</div>
                </div>
                <span class="arrow">→</span>
            </a>
        `).join('');
    }

    // ── Escape HTML ──────────────────────────────────────────────
    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ── Check handler ────────────────────────────────────────────
    async function runCheck() {
        const name = nameInput.value.trim();
        const tlds = getSelectedTlds();

        // Client-side validation
        if (!name) {
            showError('Bitte einen Namen eingeben.');
            nameInput.focus();
            return;
        }
        if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(name)) {
            showError('Name darf nur Buchstaben, Ziffern und Bindestriche enthalten (1-63 Zeichen).');
            nameInput.focus();
            return;
        }
        if (tlds.length === 0) {
            showError('Bitte mindestens eine Domain-Endung auswählen.');
            return;
        }

        hideError();
        resultsDiv.classList.remove('visible');
        loadingDiv.classList.add('visible');
        checkBtn.disabled = true;

        try {
            const data = await API.checkAvailability(name, tlds);

            renderDomains(data.domains || []);
            renderSocial(data.social || []);
            renderTrademarks(data.trademarks || []);

            loadingDiv.classList.remove('visible');
            resultsDiv.classList.add('visible');
        } catch (err) {
            loadingDiv.classList.remove('visible');
            showError(err.message || 'Verfügbarkeitsprüfung fehlgeschlagen.');
        } finally {
            checkBtn.disabled = false;
        }
    }

    function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.classList.add('visible');
    }

    function hideError() {
        errorDiv.classList.remove('visible');
    }

    // ── Event bindings ───────────────────────────────────────────
    checkBtn.addEventListener('click', runCheck);
    nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') runCheck();
    });
})();
