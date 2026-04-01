/**
 * contractApp.js — 9-Step Contract Wizard
 * - Loads template config from API
 * - Renders forms dynamically based on YAML variables/toggles
 * - Auto-saves to localStorage every change, syncs to backend periodically
 * - Generates contract preview on final step
 * - Exports as PDF or DOCX via backend
 */

const ContractApp = (() => {
    'use strict';

    const BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '/api';
    const STORAGE_KEY = 'contract_draft';
    const AUTOSAVE_INTERVAL = 30000; // 30s backend sync

    let template = null;   // YAML template config from API
    let assetRefList = null; // Reference asset list from API
    let state = {
        draftId: null,
        currentStep: 0,
        data: {},          // all form values: { VERKAEUFER_NAME: '...', HAT_MITARBEITER: false, ... }
        createdAt: null,
        updatedAt: null,
    };
    let autosaveTimer = null;
    let dirty = false;

    // ═══════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════
    async function init() {
        try {
            [template, assetRefList] = await Promise.all([
                fetchJSON('/contract/template'),
                fetchJSON('/contract/assets'),
            ]);
        } catch (e) {
            document.getElementById('wizard-content').innerHTML =
                '<p class="text-muted" style="padding:2rem">Fehler beim Laden der Vorlage. Bitte später erneut versuchen.</p>';
            console.error('Template load failed:', e);
            return;
        }

        // Check for existing local draft
        const local = loadLocal();
        if (local && local.data && Object.keys(local.data).length > 0) {
            state = local;
        } else {
            state.draftId = generateId();
            state.createdAt = new Date().toISOString();
            initDefaults();
        }

        renderSidebar();
        goToStep(state.currentStep || 0);
        startAutosave();
        bindGlobalEvents();
    }

    function initDefaults() {
        // Set all conditions to false by default
        if (template.variables && template.variables.conditions) {
            for (const c of template.variables.conditions) {
                if (c.type === 'boolean') {
                    state.data[c.id] = false;
                }
            }
        }
        // Set default types
        state.data.seller_type = '';
        state.data.buyer_type = '';
        // Initialize asset list
        if (!state.data.assetList) state.data.assetList = [];
    }

    // ═══════════════════════════════════════════════════════════════
    // NAVIGATION
    // ═══════════════════════════════════════════════════════════════
    function goToStep(idx) {
        // Save current values before navigating away
        collectFormValues();

        state.currentStep = idx;
        renderStep(idx);
        updateSidebar(idx);
        updateProgress(idx);
        saveLocal();

        // Scroll to top
        document.getElementById('main-content').scrollTo(0, 0);
    }

    function updateProgress(idx) {
        const total = template.wizard_steps.length;
        const pct = Math.round(((idx + 1) / total) * 100);
        const bar = document.getElementById('progress-bar-fill');
        const label = document.getElementById('progress-label');
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = `Schritt ${idx + 1} von ${total}`;
    }

    // ═══════════════════════════════════════════════════════════════
    // SIDEBAR
    // ═══════════════════════════════════════════════════════════════
    function renderSidebar() {
        const nav = document.getElementById('step-nav');
        nav.innerHTML = '';
        template.wizard_steps.forEach((step, i) => {
            // Check if step has a condition and should be hidden
            if (step.condition && !evalCondition(step.condition)) return;

            const li = document.createElement('li');
            li.className = 'step-nav-item';
            li.dataset.step = i;
            li.innerHTML = `
                <span class="step-num">${i + 1}</span>
                <span class="step-label">${esc(step.title)}</span>
            `;
            li.addEventListener('click', () => goToStep(i));
            nav.appendChild(li);
        });
    }

    function updateSidebar(activeIdx) {
        document.querySelectorAll('.step-nav-item').forEach(li => {
            const i = parseInt(li.dataset.step);
            li.classList.toggle('active', i === activeIdx);
            li.classList.toggle('completed', i < activeIdx);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP RENDERER
    // ═══════════════════════════════════════════════════════════════
    function renderStep(idx) {
        const step = template.wizard_steps[idx];
        if (!step) return;

        const container = document.getElementById('wizard-content');

        // Last step = preview + export
        if (idx === template.wizard_steps.length - 1) {
            renderPreviewStep(container, step);
            return;
        }

        // Asset picker step
        if (step.type === 'asset_picker') {
            renderAssetStep(container, step, idx);
            return;
        }

        let html = `<div class="step-section">`;
        html += `<h2 class="step-title">${esc(step.title)}</h2>`;
        html += `<p class="step-description">${esc(step.description)}</p>`;

        // Render variable groups for this step
        if (step.variables) {
            for (const groupKey of step.variables) {
                const vars = template.variables[groupKey];
                if (!vars) continue;
                html += renderFormGroup(vars);
            }
        }

        // Render toggle section for this step
        if (step.toggles && step.toggles.length > 0) {
            html += renderToggles(step.toggles);
        }

        // Conditional extra fields based on toggles
        html += renderConditionalFields(step);

        // Navigation
        html += `<div class="wizard-actions">`;
        if (idx > 0) {
            html += `<button class="btn-outline" onclick="ContractApp.prev()">← Zurück</button>`;
        } else {
            html += `<div></div>`;
        }
        html += `<button class="btn-primary" onclick="ContractApp.next()">Weiter →</button>`;
        html += `</div>`;

        html += `</div>`;
        container.innerHTML = html;

        // Fill saved values
        fillFormValues();
        bindFormEvents();
    }

    function renderFormGroup(vars) {
        let html = '<div class="form-grid">';
        for (const v of vars) {
            // Check condition
            if (v.condition && !evalCondition(v.condition)) continue;

            const val = state.data[v.id] || '';
            const req = v.required ? '<span class="required">*</span>' : '';
            const fullWidth = v.type === 'textarea' || v.type === 'list';
            const cls = fullWidth ? 'form-group full-width' : 'form-group';

            html += `<div class="${cls}" data-field-id="${v.id}">`;
            html += `<label for="f_${v.id}">${esc(v.label)}${req}</label>`;
            if (v.tooltip) {
                html += `<button class="tooltip-btn" type="button" onclick="ContractApp.toggleTooltip('tip_${v.id}')" aria-label="Hilfe">?</button>`;
                html += `<div class="tooltip-panel" id="tip_${v.id}" hidden>${esc(v.tooltip)}</div>`;
            }

            if (v.type === 'select' && v.options) {
                html += `<select id="f_${v.id}" name="${v.id}" data-var="${v.id}">`;
                html += `<option value="">— Bitte wählen —</option>`;
                for (const opt of v.options) {
                    const sel = val === opt ? ' selected' : '';
                    html += `<option value="${esc(opt)}"${sel}>${esc(opt)}</option>`;
                }
                html += `</select>`;
            } else if (v.type === 'textarea') {
                html += `<textarea id="f_${v.id}" name="${v.id}" data-var="${v.id}" rows="3">${esc(val)}</textarea>`;
            } else if (v.type === 'date') {
                html += `<input type="date" id="f_${v.id}" name="${v.id}" data-var="${v.id}" value="${esc(val)}">`;
            } else if (v.type === 'number') {
                html += `<input type="text" inputmode="decimal" id="f_${v.id}" name="${v.id}" data-var="${v.id}" value="${esc(val)}" placeholder="0,00">`;
            } else {
                html += `<input type="text" id="f_${v.id}" name="${v.id}" data-var="${v.id}" value="${esc(val)}">`;
            }

            if (v.hint) {
                html += `<span class="hint">${esc(v.hint)}</span>`;
            }

            html += `</div>`;
        }
        html += '</div>';
        return html;
    }

    function renderToggles(toggleIds) {
        const conditions = template.variables.conditions || [];
        const toggleVars = conditions.filter(c => toggleIds.includes(c.id));
        if (!toggleVars.length) return '';

        let html = '<div class="toggle-group">';
        html += '<h4>Optionen</h4>';
        html += '<div class="toggle-list">';

        for (const t of toggleVars) {
            const checked = state.data[t.id] === true;
            const cls = checked ? 'toggle-item active' : 'toggle-item';
            html += `
                <div class="toggle-item-wrap">
                <label class="${cls}" data-toggle="${t.id}">
                    <input type="checkbox" data-var="${t.id}" ${checked ? 'checked' : ''}>
                    <span>${esc(t.label)}</span>
                </label>${t.tooltip ? `<button class="tooltip-btn" type="button" onclick="ContractApp.toggleTooltip('tip_${t.id}')" aria-label="Hilfe">?</button>` : ''}
                </div>${t.tooltip ? `<div class="tooltip-panel" id="tip_${t.id}" hidden>${esc(t.tooltip)}</div>` : ''}`;
        }

        html += '</div></div>';
        return html;
    }

    function renderConditionalFields(step) {
        // Render additional input fields that appear when specific toggles are active
        // This covers e.g. RATEN_ANZAHL when HAT_RATENZAHLUNG is on, etc.
        let html = '';
        const extras = getExtraFieldsForStep(step);
        if (extras.length > 0) {
            html += '<div class="form-grid" id="conditional-fields">';
            for (const f of extras) {
                if (f.showIf && !state.data[f.showIf]) continue;
                const val = state.data[f.id] || '';
                html += `<div class="form-group" data-field-id="${f.id}">`;
                html += `<label for="f_${f.id}">${esc(f.label)}</label>`;
                html += `<input type="text" id="f_${f.id}" name="${f.id}" data-var="${f.id}" value="${esc(val)}">`;
                if (f.hint) html += `<span class="hint">${esc(f.hint)}</span>`;
                html += `</div>`;
            }
            html += '</div>';
        }
        return html;
    }

    function getExtraFieldsForStep(step) {
        const fields = [];
        const stepIdx = template.wizard_steps.indexOf(step);

        // Step 4 (was 3): Kaufpreis & Zahlung extras
        if (stepIdx === 3) {
            fields.push(
                { id: 'KAUFPREIS_GESAMT_WORT', label: 'Kaufpreis in Worten', showIf: null },
                { id: 'KAUFPREIS_SONSTIGES', label: 'Anteil Sonstiges (EUR)', showIf: null },
                { id: 'RATE_1_BETRAG', label: 'Erste Rate (EUR)', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATE_1_PROZENT', label: 'Erste Rate (%)', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATEN_ANZAHL', label: 'Anzahl Folgeraten', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATE_FOLGE_BETRAG', label: 'Folgerate Betrag (EUR)', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATEN_FAELLIGKEIT_TAG', label: 'Fälligkeitstag (z.B. 1.)', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATE_2_DATUM', label: 'Datum erste Folgerate', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATE_LETZTE_BETRAG', label: 'Letzte Rate (EUR)', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATE_LETZTE_DATUM', label: 'Datum letzte Rate', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATEN_ZINSSATZ', label: 'Zinssatz (%)', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'RATEN_VERZUG_TAGE', label: 'Verzugsfrist (Tage)', showIf: 'HAT_RATENZAHLUNG' },
                { id: 'VERKAEUFER_IBAN', label: 'IBAN Verkäufer', showIf: null },
                { id: 'VERKAEUFER_BIC', label: 'BIC', showIf: null },
                { id: 'VERKAEUFER_BANK', label: 'Bank', showIf: null },
                { id: 'EINBEHALT_BETRAG', label: 'Sicherheitseinbehalt (EUR)', showIf: null },
                { id: 'EINBEHALT_PROZENT', label: 'Einbehalt (%)', showIf: null },
                { id: 'EINBEHALT_MONATE', label: 'Einbehalt Dauer (Monate)', showIf: null },
            );
        }

        // Step 5 (was 4): Dates extras
        if (stepIdx === 4) {
            fields.push(
                { id: 'SIGNING_ORT', label: 'Ort der Unterzeichnung', showIf: null },
                { id: 'LONG_STOP_DATE', label: 'Long Stop Date', showIf: null },
                { id: 'WESENTLICHKEITSSCHWELLE', label: 'Wesentlichkeitsschwelle Einzeln (EUR)', showIf: null },
                { id: 'WESENTLICHKEITSSCHWELLE_GESAMT', label: 'Wesentlichkeitsschwelle Gesamt (EUR)', showIf: null },
                { id: 'MAX_VERTRAGS_LAUFZEIT', label: 'Max. Vertragslaufzeit neue Verträge (Monate)', showIf: null },
            );
        }

        // Step 6 (was 5): Guarantees & liability
        if (stepIdx === 5) {
            fields.push(
                { id: 'BILANZ_JAHRE', label: 'Bilanzjahre (z.B. 2023, 2024, 2025)', showIf: null },
                { id: 'LETZTER_BILANZSTICHTAG', label: 'Letzter Bilanzstichtag', showIf: null },
                { id: 'HAFTUNGSCAP_BETRAG', label: 'Haftungshöchstgrenze (EUR)', showIf: null },
                { id: 'HAFTUNGSCAP_PROZENT', label: 'Haftungshöchstgrenze (% vom KP)', showIf: null },
                { id: 'VERJAEHRUNG_ALLGEMEIN_MONATE', label: 'Verjährung allgemein (Monate)', showIf: null },
                { id: 'VERJAEHRUNG_STEUER_JAHRE', label: 'Verjährung Steuer (Jahre)', showIf: null },
                { id: 'VERJAEHRUNG_EIGENTUM_JAHRE', label: 'Verjährung Eigentum (Jahre)', showIf: null },
                { id: 'ABMAHNUNG_ZEITRAUM_JAHRE', label: 'Abmahnungsprüfzeitraum (Jahre)', showIf: null },
            );
        }

        // Step 8 (was 7): Non-compete & confidentiality
        if (stepIdx === 7) {
            fields.push(
                { id: 'WETTBEWERBSVERBOT_DAUER_JAHRE', label: 'Wettbewerbsverbot Dauer (Jahre)', showIf: null },
                { id: 'WETTBEWERBSVERBOT_GEBIET', label: 'Räumliches Gebiet', showIf: null },
                { id: 'WETTBEWERBSVERBOT_BRANCHE', label: 'Sachlicher Bereich / Branche', showIf: null },
                { id: 'VERTRAGSSTRAFE_BETRAG', label: 'Vertragsstrafe Wettbewerb (EUR)', showIf: null },
                { id: 'GEHEIMHALTUNG_DAUER_JAHRE', label: 'Geheimhaltungsdauer (Jahre)', showIf: null },
                { id: 'GEHEIMHALTUNG_VERTRAGSSTRAFE', label: 'Vertragsstrafe Geheimhaltung (EUR)', showIf: null },
                { id: 'EINARBEITUNG_DAUER_MONATE', label: 'Einarbeitung Dauer (Monate)', showIf: null },
                { id: 'EINARBEITUNG_STUNDEN', label: 'Stunden pro Woche', showIf: null },
                { id: 'UEBERGANG_STUNDENSATZ', label: 'Stundensatz Einarbeitung (EUR)', showIf: null, hint: 'Nur bei gesonderter Vergütung' },
            );
        }

        // Step 9 (was 8): Tax & legal
        if (stepIdx === 8) {
            fields.push(
                { id: 'GERICHTSSTAND', label: 'Gerichtsstand', showIf: null },
                { id: 'UST_SATZ', label: 'USt-Satz (%)', showIf: null, hint: 'Standard: 19' },
            );
        }

        // Step 2: Business extras (index stays 1)
        if (stepIdx === 1) {
            fields.push(
                { id: 'SOCIAL_MEDIA_PLATTFORMEN', label: 'Social-Media-Accounts', showIf: 'HAT_DOMAINS', hint: 'z.B. Instagram (@shop), Facebook, TikTok' },
                { id: 'SHOP_SYSTEM_NAME', label: 'Shop-System', showIf: 'HAT_DOMAINS', hint: 'z.B. Shopify, WooCommerce, Shopware' },
                { id: 'PAYMENT_PROVIDER', label: 'Payment-Provider', showIf: 'HAT_DOMAINS', hint: 'z.B. Stripe, PayPal, Klarna' },
                { id: 'WEITERE_AUSNAHMEN', label: 'Ausgenommene Vermögensgegenstände', showIf: null, hint: 'z.B. privater PKW, persönliche Gegenstände' },
            );
        }

        // Step 1: Party extras (index 0)
        if (stepIdx === 0) {
            fields.push(
                { id: 'LOI_DATUM', label: 'LOI-Datum', showIf: 'HAT_LOI', hint: 'Datum der Absichtserklärung' },
                { id: 'EXKLUSIVITAET_DATUM', label: 'Exklusivität seit', showIf: 'HAT_EXKLUSIVITAET', hint: 'Beginn der Exklusivitätsvereinbarung' },
            );
        }

        return fields;
    }

    // ═══════════════════════════════════════════════════════════════
    // ASSET PICKER (Step 3)
    // ═══════════════════════════════════════════════════════════════
    function renderAssetStep(container, step, idx) {
        if (!state.data.assetList) state.data.assetList = [];
        const list = state.data.assetList; // [{id, category, name, qty, unitPrice, custom}]

        // Build selected set for quick lookup
        const selectedMap = {};
        for (const item of list) selectedMap[item.id] = item;

        let html = `<div class="step-section">`;
        html += `<h2 class="step-title">${esc(step.title)}</h2>`;
        html += `<p class="step-description">${esc(step.description)}</p>`;

        // Summary bar
        const total = list.reduce((s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.unitPrice) || 0), 0);
        const totalItems = list.length;
        html += `<div class="asset-summary-bar">
            <span>${totalItems} Posten ausgewählt</span>
            <span class="asset-total">Gesamt: <strong>${fmtEur(total)}</strong></span>
        </div>`;

        // Category tabs
        const cats = assetRefList.categories;
        html += `<div class="asset-tabs">`;
        cats.forEach((cat, ci) => {
            const selCount = list.filter(i => i.category === cat.id && !i.custom).length;
            const totalCount = cat.items.length;
            const badgeCls = selCount === totalCount && totalCount > 0 ? 'badge badge-full' : 'badge';
            html += `<button class="asset-tab${ci === 0 ? ' active' : ''}" data-cat="${cat.id}">
                ${esc(cat.name)} <span class="${badgeCls}" data-badge-cat="${cat.id}">${selCount}/${totalCount}</span>
            </button>`;
        });
        const customCount = list.filter(i => i.custom).length;
        html += `<button class="asset-tab" data-cat="__custom">+ Eigener Posten${customCount > 0 ? ` <span class="badge" data-badge-cat="__custom">${customCount}</span>` : ''}</button>`;
        html += `</div>`;

        // Category panels
        cats.forEach((cat, ci) => {
            html += `<div class="asset-panel${ci === 0 ? ' active' : ''}" data-panel="${cat.id}">`;
            html += `<div class="asset-cat-actions">
                <button class="btn-sm" onclick="ContractApp.selectAllInCategory('${cat.id}')">Alle wählen</button>
                <button class="btn-sm btn-sm-outline" onclick="ContractApp.deselectAllInCategory('${cat.id}')">Alle abwählen</button>
            </div>`;
            html += `<div class="asset-item-list">`;
            for (const item of cat.items) {
                const sel = !!selectedMap[item.id];
                const qty = sel ? (selectedMap[item.id].qty || 1) : 1;
                html += `<div class="asset-item${sel ? ' selected' : ''}" data-item-id="${item.id}">
                    <label class="asset-item-check">
                        <input type="checkbox" data-asset-id="${item.id}" data-cat="${cat.id}"
                            data-name="${esc(item.name)}" data-price="${item.unitPrice}"
                            ${sel ? 'checked' : ''}>
                        <span class="asset-item-name">${esc(item.name)}</span>
                    </label>
                    <div class="asset-item-right">
                        <span class="asset-item-price">${item.unitPrice > 0 ? fmtEur(item.unitPrice) : '—'}</span>
                        <input type="number" class="asset-qty-input" min="1" step="1"
                            data-qty-for="${item.id}" value="${qty}"
                            ${sel ? '' : 'disabled'} placeholder="Menge">
                        <span class="asset-item-unit">Stk.</span>
                        ${item.unitPrice > 0
                        ? `<span class="asset-item-subtotal" data-sub="${item.id}">${sel ? fmtEur(qty * item.unitPrice) : '—'}</span>`
                        : `<input type="text" class="asset-price-input" placeholder="Preis €"
                                data-custprice-for="${item.id}"
                                value="${sel && selectedMap[item.id].unitPrice ? selectedMap[item.id].unitPrice : ''}"
                                ${sel ? '' : 'disabled'}>`
                    }
                    </div>
                </div>`;
            }
            html += `</div></div>`;
        });

        // Custom items panel
        const customItems = list.filter(i => i.custom);
        html += `<div class="asset-panel" data-panel="__custom">`;
        html += `<div class="asset-custom-form">
            <input type="text" id="custom-cat" placeholder="Kategorie" style="width:140px">
            <input type="text" id="custom-name" placeholder="Bezeichnung" style="flex:1">
            <input type="number" id="custom-qty" placeholder="Menge" value="1" min="1" style="width:70px">
            <input type="number" id="custom-price" placeholder="Preis €" step="0.01" style="width:100px">
            <button class="btn-primary btn-sm" onclick="ContractApp.addCustomItem()">Hinzufügen</button>
        </div>`;
        if (customItems.length > 0) {
            html += `<div class="asset-item-list">`;
            for (const item of customItems) {
                html += `<div class="asset-item selected" data-item-id="${item.id}">
                    <span class="asset-item-name">📦 ${esc(item.category ? item.category + ' — ' : '')}${esc(item.name)}</span>
                    <div class="asset-item-right">
                        <span>${fmtEur(item.unitPrice)}</span>
                        <span>× ${item.qty}</span>
                        <span class="asset-item-subtotal">${fmtEur(item.qty * item.unitPrice)}</span>
                        <button class="btn-sm btn-sm-danger" onclick="ContractApp.removeCustomItem('${item.id}')">✕</button>
                    </div>
                </div>`;
            }
            html += '</div>';
        }
        html += `</div>`;

        // Selected items summary table
        if (list.length > 0) {
            html += `<div class="asset-selected-summary">
                <h4>Ausgewählte Posten (${totalItems})</h4>
                <table class="asset-table">
                    <thead><tr><th>Kategorie</th><th>Bezeichnung</th><th>Menge</th><th>EP</th><th>Gesamt</th></tr></thead>
                    <tbody>`;
            for (const item of list) {
                const sub = (parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0);
                html += `<tr>
                    <td>${esc(item.category || '')}</td>
                    <td>${esc(item.name)}</td>
                    <td style="text-align:right">${item.qty}</td>
                    <td style="text-align:right">${fmtEur(item.unitPrice)}</td>
                    <td style="text-align:right">${fmtEur(sub)}</td>
                </tr>`;
            }
            html += `<tr class="asset-table-total">
                <td colspan="4"><strong>Gesamtwert</strong></td>
                <td style="text-align:right"><strong>${fmtEur(total)}</strong></td>
            </tr>`;
            html += `</tbody></table></div>`;
        }

        // Navigation
        html += `<div class="wizard-actions">
            <button class="btn-outline" onclick="ContractApp.prev()">← Zurück</button>
            <button class="btn-primary" onclick="ContractApp.next()">Weiter →</button>
        </div>`;
        html += `</div>`;

        container.innerHTML = html;
        bindAssetEvents();
    }

    function bindAssetEvents() {
        // Tab switching
        document.querySelectorAll('.asset-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.asset-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.asset-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = document.querySelector(`.asset-panel[data-panel="${tab.dataset.cat}"]`);
                if (panel) panel.classList.add('active');
            });
        });

        // Checkbox selection
        document.querySelectorAll('[data-asset-id]').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.assetId;
                const name = cb.dataset.name;
                const cat = cb.dataset.cat;
                const price = parseFloat(cb.dataset.price) || 0;
                const qtyInput = document.querySelector(`[data-qty-for="${id}"]`);
                const priceInput = document.querySelector(`[data-custprice-for="${id}"]`);
                const row = cb.closest('.asset-item');

                if (cb.checked) {
                    const qty = parseInt(qtyInput?.value) || 1;
                    const actualPrice = priceInput ? parseFloat(priceInput.value) || 0 : price;
                    addToAssetList({ id, category: cat, name, qty, unitPrice: actualPrice, custom: false });
                    if (qtyInput) qtyInput.disabled = false;
                    if (priceInput) priceInput.disabled = false;
                    if (row) row.classList.add('selected');
                } else {
                    removeFromAssetList(id);
                    if (qtyInput) { qtyInput.disabled = true; }
                    if (priceInput) { priceInput.disabled = true; }
                    if (row) row.classList.remove('selected');
                }
                updateAssetSummaryBar();
                dirty = true;
                saveLocal();
            });
        });

        // Quantity changes
        document.querySelectorAll('.asset-qty-input').forEach(input => {
            input.addEventListener('change', () => {
                const id = input.dataset.qtyFor;
                const qty = parseFloat(input.value) || 1;
                updateAssetItemQty(id, qty);
                // Update subtotal display
                const item = (state.data.assetList || []).find(i => i.id === id);
                const subEl = document.querySelector(`[data-sub="${id}"]`);
                if (subEl && item) subEl.textContent = fmtEur(qty * item.unitPrice);
                updateAssetSummaryBar();
                dirty = true;
                saveLocal();
            });
        });

        // Custom price inputs
        document.querySelectorAll('.asset-price-input').forEach(input => {
            input.addEventListener('change', () => {
                const id = input.dataset.custpriceFor;
                const price = parseFloat(input.value) || 0;
                updateAssetItemPrice(id, price);
                updateAssetSummaryBar();
                dirty = true;
                saveLocal();
            });
        });
    }

    function addToAssetList(item) {
        if (!state.data.assetList) state.data.assetList = [];
        const existing = state.data.assetList.findIndex(i => i.id === item.id);
        if (existing >= 0) {
            state.data.assetList[existing] = item;
        } else {
            state.data.assetList.push(item);
        }
    }

    function removeFromAssetList(id) {
        state.data.assetList = (state.data.assetList || []).filter(i => i.id !== id);
    }

    function updateAssetItemQty(id, qty) {
        const item = (state.data.assetList || []).find(i => i.id === id);
        if (item) item.qty = qty;
    }

    function updateAssetItemPrice(id, price) {
        const item = (state.data.assetList || []).find(i => i.id === id);
        if (item) item.unitPrice = price;
    }

    function updateAssetSummaryBar() {
        const list = state.data.assetList || [];
        const total = list.reduce((s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.unitPrice) || 0), 0);
        const bar = document.querySelector('.asset-summary-bar');
        if (bar) {
            bar.innerHTML = `<span>${list.length} Posten ausgewählt</span>
                <span class="asset-total">Gesamt: <strong>${fmtEur(total)}</strong></span>`;
        }
        // Update tab badges live
        if (assetRefList && assetRefList.categories) {
            for (const cat of assetRefList.categories) {
                const badge = document.querySelector(`[data-badge-cat="${cat.id}"]`);
                if (!badge) continue;
                const selCount = list.filter(i => i.category === cat.id && !i.custom).length;
                const totalCount = cat.items.length;
                badge.textContent = `${selCount}/${totalCount}`;
                badge.className = selCount === totalCount && totalCount > 0 ? 'badge badge-full' : 'badge';
            }
            const customBadge = document.querySelector('[data-badge-cat="__custom"]');
            if (customBadge) {
                const customCount = list.filter(i => i.custom).length;
                customBadge.textContent = customCount;
            }
        }
    }

    function selectAllInCategory(catId) {
        const cat = assetRefList.categories.find(c => c.id === catId);
        if (!cat) return;
        for (const item of cat.items) {
            if (!(state.data.assetList || []).find(i => i.id === item.id)) {
                addToAssetList({ id: item.id, category: catId, name: item.name, qty: 1, unitPrice: item.unitPrice, custom: false });
            }
        }
        dirty = true;
        saveLocal();
        renderStep(state.currentStep);
    }

    function deselectAllInCategory(catId) {
        state.data.assetList = (state.data.assetList || []).filter(i => i.category !== catId || i.custom);
        dirty = true;
        saveLocal();
        renderStep(state.currentStep);
    }

    function addCustomItem() {
        const cat = document.getElementById('custom-cat')?.value?.trim() || 'Sonstige';
        const name = document.getElementById('custom-name')?.value?.trim();
        const qty = parseFloat(document.getElementById('custom-qty')?.value) || 1;
        const price = parseFloat(document.getElementById('custom-price')?.value) || 0;
        if (!name) { alert('Bitte Bezeichnung eingeben.'); return; }
        const id = 'custom_' + Date.now();
        addToAssetList({ id, category: cat, name, qty, unitPrice: price, custom: true });
        dirty = true;
        saveLocal();
        renderStep(state.currentStep);
        // Jump back to custom tab
        setTimeout(() => {
            const tab = document.querySelector('.asset-tab[data-cat="__custom"]');
            if (tab) tab.click();
        }, 50);
    }

    function removeCustomItem(id) {
        removeFromAssetList(id);
        dirty = true;
        saveLocal();
        renderStep(state.currentStep);
        setTimeout(() => {
            const tab = document.querySelector('.asset-tab[data-cat="__custom"]');
            if (tab) tab.click();
        }, 50);
    }

    function fmtEur(val) {
        const n = parseFloat(val) || 0;
        return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    }

    // Build ANLAGE_ASSETLISTE text for contract
    function buildAssetListText() {
        const list = state.data.assetList || [];
        if (list.length === 0) return '(keine Posten erfasst)';

        // Group by category
        const byCategory = {};
        for (const item of list) {
            const cat = item.category || 'Sonstige';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(item);
        }

        let text = '\n';
        let totalAll = 0;
        for (const [cat, items] of Object.entries(byCategory)) {
            text += `\n  ${cat.toUpperCase()}\n`;
            text += `  ${'─'.repeat(60)}\n`;
            let catTotal = 0;
            for (const item of items) {
                const sub = (parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0);
                catTotal += sub;
                const priceStr = item.unitPrice > 0
                    ? `${item.qty} × ${fmtEur(item.unitPrice)} = ${fmtEur(sub)}`
                    : `${item.qty} Stk. (Preis: 0,00 €)`;
                text += `  • ${item.name.padEnd(50).substring(0, 50)}  ${priceStr}\n`;
            }
            text += `  Zwischensumme ${cat}: ${fmtEur(catTotal)}\n`;
            totalAll += catTotal;
        }
        text += `\n  ${'═'.repeat(60)}\n`;
        text += `  GESAMTWERT ASSETLISTE: ${fmtEur(totalAll)}\n`;
        return text;
    }

    // ═══════════════════════════════════════════════════════════════
    // PREVIEW & EXPORT (last step)
    function renderPreviewStep(container, step) {
        container.innerHTML = `
            <div class="step-section">
                <h2 class="step-title">${esc(step.title)}</h2>
                <p class="step-description">${esc(step.description)}</p>

                <div class="info-box">
                    ℹ️ Prüfen Sie den Vertrag sorgfältig. Nach dem Download können Sie ihn in Word weiterbearbeiten.
                </div>

                <div class="export-bar">
                    <button class="btn-export docx" onclick="ContractApp.exportDocx()">📄 Word (.docx)</button>
                    <button class="btn-export pdf" onclick="ContractApp.exportPdf()">📕 PDF</button>
                </div>

                <h3 style="margin: 1.5rem 0 .75rem; font-size: 1rem;">Vorschau</h3>
                <div class="contract-preview" id="contract-preview">
                    Vertrag wird generiert…
                </div>

                <div class="wizard-actions">
                    <button class="btn-outline" onclick="ContractApp.prev()">← Zurück</button>
                    <div></div>
                </div>
            </div>`;

        // Load preview from backend
        generatePreview();
    }

    async function generatePreview() {
        const preview = document.getElementById('contract-preview');
        try {
            const resp = await fetchJSON('/contract/generate', {
                method: 'POST',
                body: JSON.stringify(state.data),
            });
            preview.textContent = resp.contract;
        } catch (e) {
            preview.textContent = 'Fehler bei der Vertragsgenerierung: ' + e.message;
        }
    }

    async function exportDocx() {
        await doExport('docx');
    }

    async function exportPdf() {
        await doExport('pdf');
    }

    async function doExport(format) {
        try {
            const resp = await fetch(`${BASE}/contract/export/${format}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.data),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: 'Export failed' }));
                throw new Error(err.error);
            }
            const blob = await resp.blob();
            const name = (state.data.UNTERNEHMENSNAME || 'Kaufvertrag').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
            const ext = format === 'docx' ? 'docx' : 'pdf';
            downloadBlob(blob, `Asset_Kaufvertrag_${name}.${ext}`);
        } catch (e) {
            alert('Export fehlgeschlagen: ' + e.message);
        }
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ═══════════════════════════════════════════════════════════════
    // FORM VALUE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    function collectFormValues() {
        document.querySelectorAll('[data-var]').forEach(el => {
            const key = el.dataset.var;
            if (el.type === 'checkbox') {
                state.data[key] = el.checked;
            } else {
                state.data[key] = el.value;
            }
        });

        // Sync seller_type / buyer_type from rechtsform fields
        if (state.data.VERKAEUFER_RECHTSFORM) {
            state.data.seller_type = state.data.VERKAEUFER_RECHTSFORM;
        }
        if (state.data.KAEUFER_RECHTSFORM) {
            state.data.buyer_type = state.data.KAEUFER_RECHTSFORM;
        }

        // Build asset list text for contract placeholder
        state.data.ANLAGE_ASSETLISTE = buildAssetListText();
    }

    function fillFormValues() {
        document.querySelectorAll('[data-var]').forEach(el => {
            const key = el.dataset.var;
            const val = state.data[key];
            if (val === undefined) return;
            if (el.type === 'checkbox') {
                el.checked = !!val;
                // Update toggle-item class
                const parent = el.closest('.toggle-item');
                if (parent) parent.classList.toggle('active', !!val);
            } else {
                el.value = val;
            }
        });
    }

    function bindFormEvents() {
        // Toggle items
        document.querySelectorAll('.toggle-item input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const label = e.target.closest('.toggle-item');
                if (label) label.classList.toggle('active', e.target.checked);
                state.data[e.target.dataset.var] = e.target.checked;
                dirty = true;
                saveLocal();
                // Re-render to show/hide conditional fields
                renderStep(state.currentStep);
            });
        });

        // Rechtsform selects → update seller_type / buyer_type and re-render
        const sellerRF = document.querySelector('[data-var="VERKAEUFER_RECHTSFORM"]');
        if (sellerRF) {
            sellerRF.addEventListener('change', () => {
                state.data.VERKAEUFER_RECHTSFORM = sellerRF.value;
                state.data.seller_type = sellerRF.value;
                dirty = true;
                saveLocal();
                renderSidebar();
                renderStep(state.currentStep);
            });
        }
        const buyerRF = document.querySelector('[data-var="KAEUFER_RECHTSFORM"]');
        if (buyerRF) {
            buyerRF.addEventListener('change', () => {
                state.data.KAEUFER_RECHTSFORM = buyerRF.value;
                state.data.buyer_type = buyerRF.value;
                dirty = true;
                saveLocal();
                renderSidebar();
                renderStep(state.currentStep);
            });
        }

        // All inputs — mark dirty on change
        document.querySelectorAll('[data-var]').forEach(el => {
            const evt = el.type === 'checkbox' ? 'change' : 'input';
            el.addEventListener(evt, () => {
                dirty = true;
                updateSaveIndicator('saving');
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // PERSISTENCE — localStorage + backend
    // ═══════════════════════════════════════════════════════════════
    function saveLocal() {
        state.updatedAt = new Date().toISOString();
        try {
            // Save current draft
            localStorage.setItem(STORAGE_KEY + '_' + state.draftId, JSON.stringify(state));
            // Save index of all drafts
            const idx = getDraftIndex();
            const entry = idx.find(d => d.id === state.draftId);
            const name = state.data.UNTERNEHMENSNAME || 'Unbenannter Entwurf';
            if (entry) {
                entry.name = name;
                entry.updatedAt = state.updatedAt;
                entry.step = state.currentStep;
            } else {
                idx.push({ id: state.draftId, name, createdAt: state.createdAt, updatedAt: state.updatedAt, step: state.currentStep });
            }
            localStorage.setItem(STORAGE_KEY + '_index', JSON.stringify(idx));
            updateSaveIndicator('saved');
        } catch (e) {
            console.warn('localStorage save failed:', e);
        }
    }

    function loadLocal() {
        try {
            const idx = getDraftIndex();
            // Load most recent draft
            if (idx.length === 0) return null;
            idx.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            const latest = idx[0];
            const raw = localStorage.getItem(STORAGE_KEY + '_' + latest.id);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function loadDraftById(id) {
        try {
            const raw = localStorage.getItem(STORAGE_KEY + '_' + id);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function getDraftIndex() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY + '_index') || '[]');
        } catch {
            return [];
        }
    }

    function deleteDraft(id) {
        localStorage.removeItem(STORAGE_KEY + '_' + id);
        const idx = getDraftIndex().filter(d => d.id !== id);
        localStorage.setItem(STORAGE_KEY + '_index', JSON.stringify(idx));
    }

    function startAutosave() {
        autosaveTimer = setInterval(async () => {
            if (!dirty) return;
            collectFormValues();
            saveLocal();
            // Optional: sync to backend
            try {
                await fetchJSON('/contract/draft', {
                    method: 'PUT',
                    body: JSON.stringify({ draftId: state.draftId, data: state.data, currentStep: state.currentStep }),
                });
                dirty = false;
                updateSaveIndicator('saved');
            } catch {
                // Backend sync is best-effort — localStorage is primary
                updateSaveIndicator('saved');
                dirty = false;
            }
        }, AUTOSAVE_INTERVAL);
    }

    function updateSaveIndicator(status) {
        const el = document.getElementById('save-indicator');
        if (!el) return;
        el.className = 'save-indicator ' + status;
        if (status === 'saving') el.textContent = '⏳ Speichere…';
        else if (status === 'saved') el.textContent = '💾 Gespeichert';
        else if (status === 'error') el.textContent = '⚠️ Fehler';
    }

    // ═══════════════════════════════════════════════════════════════
    // DRAFT MODAL
    // ═══════════════════════════════════════════════════════════════
    function showDraftModal() {
        const modal = document.getElementById('modal-load-draft');
        const list = document.getElementById('draft-list');
        const drafts = getDraftIndex();

        if (drafts.length === 0) {
            list.innerHTML = '<p class="text-muted">Keine gespeicherten Entwürfe vorhanden.</p>';
        } else {
            drafts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            list.innerHTML = drafts.map(d => `
                <div class="draft-item" data-draft-id="${d.id}">
                    <div>
                        <div class="draft-name">${esc(d.name)}</div>
                        <div class="draft-date">Schritt ${(d.step || 0) + 1} · ${formatDate(d.updatedAt)}</div>
                    </div>
                    <button class="btn-outline" style="padding:.3rem .6rem;font-size:.75rem" onclick="event.stopPropagation();ContractApp.removeDraft('${d.id}')">✕</button>
                </div>
            `).join('');

            list.querySelectorAll('.draft-item').forEach(el => {
                el.addEventListener('click', () => {
                    const id = el.dataset.draftId;
                    const draft = loadDraftById(id);
                    if (draft) {
                        state = draft;
                        renderSidebar();
                        goToStep(state.currentStep || 0);
                        modal.style.display = 'none';
                    }
                });
            });
        }

        modal.style.display = '';
    }

    function removeDraft(id) {
        if (id === state.draftId) {
            alert('Der aktuelle Entwurf kann nicht gelöscht werden.');
            return;
        }
        deleteDraft(id);
        showDraftModal(); // refresh
    }

    function startNewDraft() {
        state = {
            draftId: generateId(),
            currentStep: 0,
            data: {},
            createdAt: new Date().toISOString(),
            updatedAt: null,
        };
        initDefaults();
        renderSidebar();
        goToStep(0);
        document.getElementById('modal-load-draft').style.display = 'none';
    }

    // ═══════════════════════════════════════════════════════════════
    // CONDITION EVALUATOR (simplified for frontend)
    // ═══════════════════════════════════════════════════════════════
    function evalCondition(condition) {
        if (!condition || condition === 'null') return true;
        const d = state.data;
        try {
            let expr = condition;
            // Replace condition variables with values
            expr = expr.replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\bNOT\b/gi, '!');
            // Handle 'X == Y' comparisons
            expr = expr.replace(/(\w+)\s*==\s*'([^']+)'/g, (_, v, val) => (d[v] === val) ? 'true' : 'false');
            // Handle IN [...]
            expr = expr.replace(/(\w+)\s+IN\s+\[([^\]]+)\]/gi, (_, v, arr) => {
                const items = arr.split(',').map(s => s.trim().replace(/'/g, ''));
                return items.includes(d[v]) ? 'true' : 'false';
            });
            // Handle NOT IN [...]
            expr = expr.replace(/(\w+)\s+!IN\s+\[([^\]]+)\]/gi, (_, v, arr) => {
                const items = arr.split(',').map(s => s.trim().replace(/'/g, ''));
                return !items.includes(d[v]) ? 'true' : 'false';
            });
            // Replace boolean variables
            for (const [k, v] of Object.entries(d)) {
                if (typeof v === 'boolean') {
                    expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v.toString());
                }
            }
            return Function('"use strict"; return (' + expr + ')')();
        } catch (e) {
            console.warn('[contractApp] evalCondition failed for "' + condition + '":', e.message, '— defaulting to show');
            return true; // default show
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GLOBAL EVENTS
    // ═══════════════════════════════════════════════════════════════
    function bindGlobalEvents() {
        document.getElementById('btn-load-draft').addEventListener('click', showDraftModal);
        document.getElementById('btn-close-modal').addEventListener('click', () => {
            document.getElementById('modal-load-draft').style.display = 'none';
        });
        document.getElementById('btn-new-draft').addEventListener('click', startNewDraft);

        // Save before unload
        window.addEventListener('beforeunload', () => {
            collectFormValues();
            saveLocal();
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════
    async function fetchJSON(path, opts = {}) {
        const defaults = {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        };
        const merged = { ...defaults, ...opts, headers: { ...defaults.headers, ...(opts.headers || {}) } };
        const resp = await fetch(`${BASE}${path}`, merged);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'API Error');
        return data;
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    function esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    function toggleTooltip(id) {
        const el = document.getElementById(id);
        if (el) el.hidden = !el.hidden;
    }

    function next() {
        collectFormValues();
        saveLocal();
        const maxStep = template.wizard_steps.length - 1;
        if (state.currentStep < maxStep) goToStep(state.currentStep + 1);
    }

    function prev() {
        collectFormValues();
        saveLocal();
        if (state.currentStep > 0) goToStep(state.currentStep - 1);
    }

    // ─── Boot ────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);

    return {
        next,
        prev,
        exportPdf,
        exportDocx,
        showDraftModal,
        removeDraft,
        startNewDraft,
        selectAllInCategory,
        deselectAllInCategory,
        addCustomItem,
        removeCustomItem,
        toggleTooltip,
    };
})();

window.ContractApp = ContractApp;
