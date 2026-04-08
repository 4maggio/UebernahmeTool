/**
 * planApp.js — 5-Jahres-Plan interaktive Finanzplanung
 *
 * Keine Backend-Abhängigkeit. Alles wird im Browser berechnet und optional im
 * localStorage gespeichert (Auto-Save).
 *
 * Struktur:
 *  - State: alle Eingaben + berechnete Ergebnisse
 *  - Recalculate: GuV, Tilgungsplan, Free Cashflow
 *  - Render: Tabellen, Charts, KPIs
 *  - UI-Helpers: Tabs, Rows, Scenarios
 */

const Plan = (() => {
    'use strict';

    // ── Constants ────────────────────────────────────────────────────
    const YEARS = 5;
    const STORAGE_KEY = 'plan_state_v1';

    const SCENARIO_MULTIPLIERS = {
        base: { revenue: 1.0,  costs: 1.0  },
        bull: { revenue: 1.15, costs: 0.92 },
        bear: { revenue: 0.82, costs: 1.08 },
    };

    const SCENARIO_LABELS = { base: 'Basis', bull: 'Optimistisch', bear: 'Pessimistisch' };

    // ── Default State ─────────────────────────────────────────────────
    function defaultState() {
        return {
            scenario: 'base',
            globalGrowthRevenue: 5,   // % p.a.
            globalGrowthCosts: 3,     // % p.a.
            revenueRows: [
                { id: uid(), name: 'Hauptumsatz (Produkte/DL)', base: 320000, growth: null },
                { id: uid(), name: 'Wiederkehrende Erlöse / Abo', base: 24000, growth: null },
                { id: uid(), name: 'Sonstige Erlöse', base: 12000, growth: null },
            ],
            fixcostRows: [
                { id: uid(), name: 'Personalkosten (exkl. Inhabergehalt)', base: 85000, growth: null },
                { id: uid(), name: 'Miete / Leasingkosten', base: 18000, growth: null },
                { id: uid(), name: 'Marketing & Werbung', base: 20000, growth: null },
                { id: uid(), name: 'IT / Software / Tools', base: 12000, growth: null },
                { id: uid(), name: 'Versicherungen', base: 6000, growth: null },
                { id: uid(), name: 'Buchführung / Beratung', base: 8000, growth: null },
                { id: uid(), name: 'Sonstige Fixkosten', base: 10000, growth: null },
            ],
            varcostRows: [
                { id: uid(), name: 'Wareneinsatz / COGS', pct: 35 },
                { id: uid(), name: 'Zahlungsabwicklung (Gebühren etc.)', pct: 2 },
            ],
            capexRows: [
                { id: uid(), name: 'IT-Infrastruktur / Hardware', vals: [5000, 2000, 3000, 2000, 2000] },
                { id: uid(), name: 'Umbau / Ausstattung', vals: [15000, 0, 0, 0, 0] },
            ],
            milestones: [
                { year: 1, category: 'Betrieb', text: 'Übergabe abgeschlossen, Kernteam gehalten' },
                { year: 2, category: 'Wachstum', text: 'Neues Vertriebskanal erschlossen' },
                { year: 3, category: 'Finanzen', text: 'Break-even Eigenkapital erreicht' },
                { year: 5, category: 'Exit/Strategie', text: 'Optionaler Verkauf / Nachfolge prüfen' },
            ],
        };
    }

    // ── State ─────────────────────────────────────────────────────────
    let state = defaultState();
    let charts = {};

    // ── UID helper ────────────────────────────────────────────────────
    function uid() {
        return Math.random().toString(36).slice(2, 8);
    }

    // ── Number formatting ─────────────────────────────────────────────
    const fmt = n =>
        new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n);
    const fmtEur = n =>
        new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
    const fmtPct = n =>
        new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 }).format(n / 100);

    // ── Read sidebar globals ──────────────────────────────────────────
    function readGlobals() {
        return {
            company:       document.getElementById('s-company')?.value || '',
            startYear:     parseInt(document.getElementById('s-start-year')?.value) || 2026,
            purchasePrice: parseFloat(document.getElementById('s-purchase-price')?.value) || 0,
            equity:        parseFloat(document.getElementById('s-equity')?.value) || 0,
            debt:          parseFloat(document.getElementById('s-debt')?.value) || 0,
            interestRate:  parseFloat(document.getElementById('s-interest-rate')?.value) || 0,
            loanTerm:      parseInt(document.getElementById('s-loan-term')?.value) || 7,
            ownerSalary:   parseFloat(document.getElementById('s-owner-salary')?.value) || 0,
            taxRate:       parseFloat(document.getElementById('s-tax-rate')?.value) || 28,
        };
    }

    // ── Loan / Tilgungsplan ──────────────────────────────────────────
    function calcLoan(g) {
        const { debt, interestRate, loanTerm } = g;
        if (!debt || !loanTerm) return Array(YEARS).fill({ interest: 0, repayment: 0, annuity: 0, balance: 0 });

        const r = interestRate / 100;
        // Annuitätendarlehen
        const annuity = r > 0
            ? debt * r * Math.pow(1 + r, loanTerm) / (Math.pow(1 + r, loanTerm) - 1)
            : debt / loanTerm;

        const rows = [];
        let balance = debt;
        for (let i = 0; i < YEARS; i++) {
            if (balance <= 0) {
                rows.push({ interest: 0, repayment: 0, annuity: 0, balance: 0 });
                continue;
            }
            const interest = balance * r;
            const repayment = Math.min(annuity - interest, balance);
            balance = Math.max(0, balance - repayment);
            rows.push({ interest, repayment, annuity: interest + repayment, balance });
        }
        return rows;
    }

    // ── Project a single row value over N years ───────────────────────
    function project(base, growthOverride, globalGrowth, scenarioMult) {
        const g = (growthOverride !== null && growthOverride !== undefined ? growthOverride : globalGrowth) / 100;
        const vals = [];
        for (let i = 0; i < YEARS; i++) {
            vals.push(base * Math.pow(1 + g, i) * scenarioMult);
        }
        return vals;
    }

    // ── Core calculation ──────────────────────────────────────────────
    function calculate() {
        const g = readGlobals();
        const sm = SCENARIO_MULTIPLIERS[state.scenario];

        // Years array
        const years = Array.from({ length: YEARS }, (_, i) => g.startYear + i);

        // Revenue projection
        const revProjections = state.revenueRows.map(r =>
            project(r.base, r.growth, state.globalGrowthRevenue, sm.revenue)
        );
        const totalRevenue = Array(YEARS).fill(0).map((_, i) =>
            revProjections.reduce((sum, p) => sum + p[i], 0)
        );

        // Fixed costs projection
        const fixProjections = state.fixcostRows.map(r =>
            project(r.base, r.growth, state.globalGrowthCosts, sm.costs)
        );
        const totalFixcosts = Array(YEARS).fill(0).map((_, i) =>
            fixProjections.reduce((sum, p) => sum + p[i], 0)
        );

        // Variable costs
        const totalVarcosts = Array(YEARS).fill(0).map((_, i) =>
            state.varcostRows.reduce((sum, r) => sum + totalRevenue[i] * r.pct / 100, 0) * sm.costs
        );

        // Owner salary (constant, treated as fixed cost)
        const ownerSalary = Array(YEARS).fill(g.ownerSalary);

        // Total costs
        const totalCosts = Array(YEARS).fill(0).map((_, i) =>
            totalFixcosts[i] + totalVarcosts[i] + ownerSalary[i]
        );

        // EBITDA
        const ebitda = Array(YEARS).fill(0).map((_, i) => totalRevenue[i] - totalCosts[i]);

        // Loan
        const loanRows = calcLoan(g);
        const interest   = loanRows.map(r => r.interest);
        const repayment  = loanRows.map(r => r.repayment);
        const loanBalance = loanRows.map(r => r.balance);

        // EBIT (simplified: ignore D&A for now, note in UI)
        const ebit = ebitda.map((v, i) => v - interest[i]);

        // Tax
        const taxBase = ebit.map(v => Math.max(0, v));
        const tax = taxBase.map(v => v * g.taxRate / 100);

        // Net income
        const netIncome = ebit.map((v, i) => v - tax[i]);

        // CapEx per year
        const capex = Array(YEARS).fill(0).map((_, i) =>
            state.capexRows.reduce((sum, r) => sum + (r.vals[i] || 0), 0)
        );

        // Free Cash Flow = EBITDA - Interest - Tax - Repayment - CapEx
        const fcf = Array(YEARS).fill(0).map((_, i) =>
            ebitda[i] - interest[i] - tax[i] - repayment[i] - capex[i]
        );

        // Cumulative FCF
        const cumFcf = [];
        let acc = 0;
        for (let i = 0; i < YEARS; i++) {
            acc += fcf[i];
            cumFcf.push(acc);
        }

        // Payback of equity
        let paybackYear = null;
        let accPayback = 0;
        for (let i = 0; i < YEARS; i++) {
            accPayback += fcf[i];
            if (accPayback >= g.equity && paybackYear === null) {
                paybackYear = i + 1;
            }
        }

        // ROI
        const roi = g.equity > 0 ? cumFcf[YEARS - 1] / g.equity * 100 : null;

        return {
            years, g,
            totalRevenue, revProjections, totalFixcosts, fixProjections,
            totalVarcosts, totalCosts, ownerSalary,
            ebitda, ebit, tax, netIncome,
            interest, repayment, loanBalance, capex,
            fcf, cumFcf,
            paybackYear, roi, loanRows,
            ebitdaMargin: ebitda.map((v, i) => totalRevenue[i] > 0 ? v / totalRevenue[i] * 100 : 0),
        };
    }

    // ── Recalculate & render ──────────────────────────────────────────
    function recalculate() {
        const result = calculate();
        renderKPIs(result);
        renderOverviewTable(result);
        renderLoanTable(result);
        renderCFTable(result);
        renderCharts(result);
        renderRiskCallouts(result);
        saveState();
    }

    // ── KPIs ──────────────────────────────────────────────────────────
    function renderKPIs(r) {
        const avgRev = r.totalRevenue.reduce((a, b) => a + b, 0) / YEARS;
        const cumEbitda = r.ebitda.reduce((a, b) => a + b, 0);
        const cumFcf = r.cumFcf[YEARS - 1];

        setText('kpi-avg-revenue', fmtEur(avgRev));
        setText('kpi-cum-ebitda', fmtEur(cumEbitda));
        setText('kpi-cum-fcf', fmtEur(cumFcf));
        setText('kpi-debt-end', fmtEur(r.loanBalance[YEARS - 1]));
        setText('kpi-roi', r.roi !== null ? `${r.roi.toFixed(0)} %` : '—');

        const kpiPayback = document.getElementById('kpi-payback');
        const paybackBar = document.getElementById('payback-bar');
        const kpiPaybackBox = document.getElementById('kpi-payback-box');
        if (r.paybackYear) {
            kpiPayback.textContent = `${r.paybackYear} J.`;
            if (paybackBar) paybackBar.style.width = `${Math.min(100, r.paybackYear / YEARS * 100)}%`;
            kpiPaybackBox.className = `kpi-box ${r.paybackYear <= 3 ? 'positive' : r.paybackYear <= 5 ? 'neutral' : ''}`;
        } else {
            kpiPayback.textContent = '> 5 J.';
            if (paybackBar) paybackBar.style.width = '100%';
            kpiPaybackBox.className = 'kpi-box negative';
        }

        // Color cumFcf
        document.getElementById('kpi-cum-fcf').closest('.kpi-box').className =
            `kpi-box ${cumFcf >= 0 ? 'positive' : 'negative'}`;

        // Scenario pill
        setText('scenario-pill', SCENARIO_LABELS[state.scenario]);
    }

    // ── Overview table ────────────────────────────────────────────────
    function renderOverviewTable(r) {
        updateYearHeaders(['ov-y1','ov-y2','ov-y3','ov-y4','ov-y5'], r.years);

        const rows = [
            { label: 'EINNAHMEN', section: true },
            { label: 'Gesamtumsatz', vals: r.totalRevenue, bold: true },
            { label: 'AUSGABEN', section: true },
            { label: 'Variable Kosten', vals: r.totalVarcosts },
            { label: 'Fixkosten (ohne Gehalt)', vals: r.totalFixcosts },
            { label: 'Inhabergehalt', vals: r.ownerSalary },
            { label: 'Gesamtkosten', vals: r.totalCosts, bold: true },
            { label: 'EBITDA', vals: r.ebitda, total: true, highlight: true },
            { label: 'EBITDA-Marge', vals: r.ebitdaMargin, pct: true },
            { label: 'FINANZIERUNG', section: true },
            { label: 'Zinsen', vals: r.interest, negative: true },
            { label: 'EBIT', vals: r.ebit, bold: true },
            { label: 'Steuern (est.)', vals: r.tax, negative: true },
            { label: 'Jahresüberschuss', vals: r.netIncome, total: true },
        ];

        renderStandardTable('overview-tbody', rows);
    }

    // ── Loan table ────────────────────────────────────────────────────
    function renderLoanTable(r) {
        updateYearHeaders(['ln-y1','ln-y2','ln-y3','ln-y4','ln-y5'], r.years);

        const totalAnnuity = r.interest.map((v, i) => v + r.repayment[i]);
        const rows = [
            { label: 'Annuität (gesamt)', vals: totalAnnuity, bold: true },
            { label: '— davon Zinsen', vals: r.interest },
            { label: '— davon Tilgung', vals: r.repayment },
            { label: 'Restschuld (Jahresende)', vals: r.loanBalance, total: true },
        ];

        renderStandardTable('loan-tbody', rows);
    }

    // ── CF table ──────────────────────────────────────────────────────
    function renderCFTable(r) {
        updateYearHeaders(['cf-y1','cf-y2','cf-y3','cf-y4','cf-y5'], r.years);

        const rows = [
            { label: 'EBITDA', vals: r.ebitda, bold: true },
            { label: '– Zinsen', vals: r.interest.map(v => -v) },
            { label: '– Steuern', vals: r.tax.map(v => -v) },
            { label: '– Tilgung', vals: r.repayment.map(v => -v) },
            { label: '– CapEx', vals: r.capex.map(v => -v) },
            { label: 'Free Cashflow', vals: r.fcf, total: true, highlight: true },
            { label: 'Kumulierter FCF', vals: r.cumFcf, bold: true },
        ];

        renderStandardTable('cf-tbody', rows);
    }

    // ── Generic table renderer ────────────────────────────────────────
    function renderStandardTable(tbodyId, rows) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = '';

        rows.forEach(row => {
            const tr = document.createElement('tr');
            if (row.section) {
                tr.className = 'section-header';
                tr.innerHTML = `<td colspan="${YEARS + 2}">${row.label}</td>`;
                tbody.appendChild(tr);
                return;
            }
            if (row.total) tr.className = 'total-row';
            if (row.highlight) tr.className = 'highlight-row';

            const sum = row.vals ? row.vals.reduce((a, b) => a + b, 0) : 0;

            let html = `<td style="${row.bold ? 'font-weight:700' : ''}">${row.label}</td>`;
            (row.vals || []).forEach(v => {
                const cls = row.pct ? '' : (v < 0 ? ' negative' : '');
                const display = row.pct ? `${v.toFixed(1)} %` : fmtEur(v);
                html += `<td class="${cls}">${display}</td>`;
            });
            const sumDisplay = row.pct ? `${(sum / YEARS).toFixed(1)} %` : fmtEur(sum);
            html += `<td>${sumDisplay}</td>`;

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    }

    // ── Update year headers ───────────────────────────────────────────
    function updateYearHeaders(ids, years) {
        ids.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.textContent = years[i] || `J${i + 1}`;
        });
    }

    // ── Charts ────────────────────────────────────────────────────────
    function renderCharts(r) {
        const labels = r.years.map(String);

        // Overview chart
        destroyChart('chart-overview');
        const overviewCtx = document.getElementById('chart-overview');
        if (overviewCtx) {
            charts['chart-overview'] = new Chart(overviewCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Umsatz',
                            data: r.totalRevenue,
                            backgroundColor: 'rgba(26,86,219,0.25)',
                            borderColor: '#1a56db',
                            borderWidth: 2,
                            borderRadius: 4,
                            order: 2,
                        },
                        {
                            label: 'EBITDA',
                            data: r.ebitda,
                            backgroundColor: 'rgba(5,122,85,0.22)',
                            borderColor: '#057a55',
                            borderWidth: 2,
                            borderRadius: 4,
                            order: 3,
                        },
                        {
                            type: 'line',
                            label: 'Free Cashflow',
                            data: r.fcf,
                            borderColor: '#6366f1',
                            backgroundColor: 'transparent',
                            borderWidth: 2.5,
                            pointRadius: 4,
                            tension: 0.35,
                            order: 1,
                        },
                    ],
                },
                options: chartOptions('€'),
            });
        }

        // Revenue stacked chart
        destroyChart('chart-revenue');
        const revCtx = document.getElementById('chart-revenue');
        if (revCtx) {
            const colors = ['#1a56db','#057a55','#d97706','#7c3aed','#be185d','#0891b2','#16a34a'];
            charts['chart-revenue'] = new Chart(revCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: state.revenueRows.map((row, idx) => ({
                        label: row.name,
                        data: r.revProjections[idx],
                        backgroundColor: hexAlpha(colors[idx % colors.length], 0.75),
                        borderColor: colors[idx % colors.length],
                        borderWidth: 1.5,
                        borderRadius: 3,
                    })),
                },
                options: { ...chartOptions('€'), scales: { ...stackedScales('€') } },
            });
        }

        // Costs chart
        destroyChart('chart-costs');
        const costCtx = document.getElementById('chart-costs');
        if (costCtx) {
            charts['chart-costs'] = new Chart(costCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Variable Kosten', data: r.totalVarcosts, backgroundColor: 'rgba(239,68,68,0.5)', borderColor: '#ef4444', borderWidth: 1.5, borderRadius: 3 },
                        { label: 'Fixkosten', data: r.totalFixcosts, backgroundColor: 'rgba(249,115,22,0.45)', borderColor: '#f97316', borderWidth: 1.5, borderRadius: 3 },
                        { label: 'Inhabergehalt', data: r.ownerSalary, backgroundColor: 'rgba(234,179,8,0.45)', borderColor: '#eab308', borderWidth: 1.5, borderRadius: 3 },
                    ],
                },
                options: { ...chartOptions('€'), scales: { ...stackedScales('€') } },
            });
        }

        // Loan balance line chart
        destroyChart('chart-loan');
        const loanCtx = document.getElementById('chart-loan');
        if (loanCtx) {
            const startBalance = r.g.debt;
            charts['chart-loan'] = new Chart(loanCtx, {
                type: 'line',
                data: {
                    labels: ['Start', ...labels],
                    datasets: [
                        {
                            label: 'Restschuld',
                            data: [startBalance, ...r.loanBalance],
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239,68,68,0.1)',
                            fill: true,
                            borderWidth: 2.5,
                            pointRadius: 4,
                            tension: 0.25,
                        },
                    ],
                },
                options: chartOptions('€'),
            });
        }

        // Cumulative FCF
        destroyChart('chart-cf');
        const cfCtx = document.getElementById('chart-cf');
        if (cfCtx) {
            charts['chart-cf'] = new Chart(cfCtx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Free Cashflow p.a.',
                            data: r.fcf,
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99,102,241,0.1)',
                            fill: false,
                            borderWidth: 2,
                            tension: 0.3,
                            pointRadius: 4,
                        },
                        {
                            label: 'Kumulierter FCF',
                            data: r.cumFcf,
                            borderColor: '#057a55',
                            backgroundColor: 'rgba(5,122,85,0.12)',
                            fill: true,
                            borderWidth: 2.5,
                            tension: 0.3,
                            pointRadius: 4,
                        },
                    ],
                },
                options: chartOptions('€'),
            });
        }
    }

    function destroyChart(id) {
        if (charts[id]) {
            charts[id].destroy();
            delete charts[id];
        }
    }

    function chartOptions(unit) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { font: { family: 'Inter', size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${fmtEur(ctx.raw)}`,
                    },
                },
            },
            scales: {
                x: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { family: 'Inter', size: 11 } } },
                y: {
                    grid: { color: 'rgba(0,0,0,.05)' },
                    ticks: {
                        font: { family: 'Inter', size: 11 },
                        callback: v => fmtEur(v),
                    },
                },
            },
        };
    }

    function stackedScales(unit) {
        return {
            x: { stacked: true, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { family: 'Inter', size: 11 } } },
            y: {
                stacked: true,
                grid: { color: 'rgba(0,0,0,.05)' },
                ticks: { font: { family: 'Inter', size: 11 }, callback: v => fmtEur(v) },
            },
        };
    }

    function hexAlpha(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // ── Risk callouts ──────────────────────────────────────────────────
    function renderRiskCallouts(r) {
        const container = document.getElementById('risk-callouts');
        if (!container) return;

        const callouts = [];

        // Low EBITDA margin warning
        const minMargin = Math.min(...r.ebitdaMargin);
        if (minMargin < 5) {
            callouts.push({ type: 'danger', msg: `EBITDA-Marge fällt unter 5 % (Min: ${minMargin.toFixed(1)} %). Kostenstruktur und Preissetzung prüfen.` });
        } else if (minMargin < 12) {
            callouts.push({ type: 'warn', msg: `EBITDA-Marge unter 12 % in mindestens einem Jahr (Min: ${minMargin.toFixed(1)} %). Puffer für unvorhergesehene Kosten ist gering.` });
        } else {
            callouts.push({ type: 'success', msg: `EBITDA-Marge durchgehend über 12 % — gesunde operative Basis.` });
        }

        // Negative FCF
        const negFCF = r.fcf.filter(v => v < 0).length;
        if (negFCF > 0) {
            callouts.push({ type: 'warn', msg: `In ${negFCF} von 5 Jahren ist der Free Cashflow negativ. Liquiditätsreserve einplanen.` });
        }

        // Payback
        if (!r.paybackYear) {
            callouts.push({ type: 'danger', msg: `Das eingesetzte Eigenkapital (${fmtEur(r.g.equity)}) wird innerhalb von 5 Jahren nicht zurückgezahlt.` });
        } else if (r.paybackYear <= 3) {
            callouts.push({ type: 'success', msg: `Eigenkapital-Amortisation in ${r.paybackYear} Jahr(en) — sehr guter Wert.` });
        }

        // High debt service
        const annuity1 = r.interest[0] + r.repayment[0];
        const debtServiceRatio = r.ebitda[0] > 0 ? annuity1 / r.ebitda[0] : 1;
        if (debtServiceRatio > 0.6) {
            callouts.push({ type: 'danger', msg: `Schuldendienst im Jahr 1 (${fmtEur(annuity1)}) entspricht ${(debtServiceRatio * 100).toFixed(0)} % des EBITDA — kritisch hoch.` });
        } else if (debtServiceRatio > 0.4) {
            callouts.push({ type: 'warn', msg: `Schuldendienst im Jahr 1 entspricht ${(debtServiceRatio * 100).toFixed(0)} % des EBITDA. Auf Liquiditätspuffer achten.` });
        }

        container.innerHTML = callouts.map(c =>
            `<div class="callout ${c.type}" style="margin-bottom:.75rem">${c.msg}</div>`
        ).join('');
    }

    // ── Revenue / Cost row rendering ──────────────────────────────────
    function renderRevenueRows() {
        const tbody = document.getElementById('revenue-rows');
        if (!tbody) return;
        tbody.innerHTML = '';
        state.revenueRows.forEach((row, idx) => {
            tbody.appendChild(makeItemRow(row, idx, 'revenue'));
        });
    }

    function renderFixcostRows() {
        const tbody = document.getElementById('fixcost-rows');
        if (!tbody) return;
        tbody.innerHTML = '';
        state.fixcostRows.forEach((row, idx) => {
            tbody.appendChild(makeItemRow(row, idx, 'fixcost'));
        });
    }

    function renderVarcostRows() {
        const tbody = document.getElementById('varcost-rows');
        if (!tbody) return;
        tbody.innerHTML = '';
        state.varcostRows.forEach((row, idx) => {
            tbody.appendChild(makeVarcostRow(row, idx));
        });
    }

    function renderCapexRows() {
        const tbody = document.getElementById('capex-rows');
        if (!tbody) return;
        tbody.innerHTML = '';
        state.capexRows.forEach((row, idx) => {
            tbody.appendChild(makeCapexRow(row, idx));
        });
    }

    function makeItemRow(row, idx, type) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${escHtml(row.name)}" onchange="Plan._updateRowName('${type}', '${row.id}', this.value)" style="min-width:160px"></td>
            <td class="right"><input type="number" value="${row.base}" min="0" step="1000" onchange="Plan._updateRowBase('${type}', '${row.id}', this.value)"></td>
            <td class="right">
                <input type="number" value="${row.growth !== null && row.growth !== undefined ? row.growth : ''}" min="-100" max="200" step="0.5" placeholder="global"
                    onchange="Plan._updateRowGrowth('${type}', '${row.id}', this.value)" style="width:70px">
            </td>
            <td><button class="btn-icon-del" onclick="Plan._deleteRow('${type}', '${row.id}')" title="Löschen">×</button></td>
        `;
        return tr;
    }

    function makeVarcostRow(row, idx) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${escHtml(row.name)}" onchange="Plan._updateVarcostName('${row.id}', this.value)" style="min-width:180px"></td>
            <td class="right"><input type="number" value="${row.pct}" min="0" max="100" step="0.5" onchange="Plan._updateVarcostPct('${row.id}', this.value)" style="width:80px"></td>
            <td><button class="btn-icon-del" onclick="Plan._deleteRow('varcost', '${row.id}')" title="Löschen">×</button></td>
        `;
        return tr;
    }

    function makeCapexRow(row, idx) {
        const g = readGlobals();
        const startYear = g.startYear;
        const tr = document.createElement('tr');
        const yearInputs = row.vals.map((v, i) =>
            `<td class="right"><input type="number" value="${v}" min="0" step="500" onchange="Plan._updateCapexVal('${row.id}', ${i}, this.value)" style="width:80px"></td>`
        ).join('');
        tr.innerHTML = `
            <td><input type="text" value="${escHtml(row.name)}" onchange="Plan._updateCapexName('${row.id}', this.value)" style="min-width:160px"></td>
            ${yearInputs}
            <td><button class="btn-icon-del" onclick="Plan._deleteRow('capex', '${row.id}')" title="Löschen">×</button></td>
        `;
        return tr;
    }

    // ── Milestone rendering ───────────────────────────────────────────
    function renderMilestones() {
        const list = document.getElementById('milestone-list');
        if (!list) return;
        list.innerHTML = '';
        const g = readGlobals();
        const startYear = g.startYear;
        state.milestones.forEach((ms, idx) => {
            const div = document.createElement('div');
            div.className = 'milestone-item';
            div.innerHTML = `
                <div class="ms-year">${startYear + ms.year - 1}</div>
                <div style="display:flex;flex-direction:column;gap:.35rem;flex:1">
                    <select onchange="Plan._updateMsCategory(${idx}, this.value)">
                        ${['Betrieb','Wachstum','Finanzen','Personal','Produkt','Exit/Strategie'].map(c =>
                            `<option ${ms.category === c ? 'selected' : ''}>${c}</option>`
                        ).join('')}
                    </select>
                    <input type="text" value="${escHtml(ms.text)}" placeholder="Meilenstein beschreiben…" onchange="Plan._updateMsText(${idx}, this.value)">
                </div>
                <div style="display:flex;flex-direction:column;gap:.3rem;align-items:center">
                    <label style="font-size:.7rem;color:var(--c-text-muted)">Jahr</label>
                    <input type="number" value="${ms.year}" min="1" max="${YEARS}" step="1" style="width:48px;text-align:center;border:1px solid var(--c-border);border-radius:5px;padding:.3rem" onchange="Plan._updateMsYear(${idx}, this.value)">
                    <button class="btn-icon-del" onclick="Plan._deleteMilestone(${idx})">×</button>
                </div>
            `;
            list.appendChild(div);
        });
    }

    // ── Growth sliders ─────────────────────────────────────────────────
    function renderGrowthSliders() {
        const container = document.getElementById('growth-sliders');
        if (!container) return;
        const sliders = [
            { key: 'globalGrowthRevenue', label: 'Umsatzwachstum %/J', min: -20, max: 40 },
            { key: 'globalGrowthCosts',  label: 'Kostenentwicklung %/J', min: -10, max: 30 },
        ];
        container.innerHTML = sliders.map(s => `
            <div class="assumption-item">
                <label>${s.label}</label>
                <div class="range-row">
                    <input type="range" min="${s.min}" max="${s.max}" step="0.5" value="${state[s.key]}"
                        oninput="Plan._sliderChange('${s.key}', this.value)">
                    <span class="range-val" id="slider-val-${s.key}">${state[s.key]} %</span>
                </div>
            </div>
        `).join('');
    }

    // ── Public API ────────────────────────────────────────────────────

    function showTab(name, btn) {
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.plan-tab-btn').forEach(b => b.classList.remove('active'));
        const panel = document.getElementById(`tab-${name}`);
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
    }

    function setScenario(scenario, btn) {
        state.scenario = scenario;
        document.querySelectorAll('.scenario-btn').forEach(b => {
            b.className = 'scenario-btn';
        });
        if (btn) btn.className = `scenario-btn active-${scenario}`;
        recalculate();
    }

    function addRevenueRow() {
        state.revenueRows.push({ id: uid(), name: 'Neue Erlösquelle', base: 0, growth: null });
        renderRevenueRows();
        recalculate();
    }

    function addFixcostRow() {
        state.fixcostRows.push({ id: uid(), name: 'Neue Fixkostenposition', base: 0, growth: null });
        renderFixcostRows();
        recalculate();
    }

    function addVarcostRow() {
        state.varcostRows.push({ id: uid(), name: 'Neue variable Kostenposition', pct: 0 });
        renderVarcostRows();
        recalculate();
    }

    function addCapexRow() {
        state.capexRows.push({ id: uid(), name: 'Neue Investition', vals: [0, 0, 0, 0, 0] });
        renderCapexRows();
        recalculate();
    }

    function addMilestone() {
        state.milestones.push({ year: 1, category: 'Betrieb', text: '' });
        renderMilestones();
    }

    // ── Internal mutators (called from inline HTML events) ────────────

    function _updateRowName(type, id, val) {
        const row = findRow(type, id);
        if (row) { row.name = val; saveState(); }
    }

    function _updateRowBase(type, id, val) {
        const row = findRow(type, id);
        if (row) { row.base = parseFloat(val) || 0; recalculate(); }
    }

    function _updateRowGrowth(type, id, val) {
        const row = findRow(type, id);
        if (row) { row.growth = val === '' ? null : parseFloat(val); recalculate(); }
    }

    function _updateVarcostName(id, val) {
        const row = state.varcostRows.find(r => r.id === id);
        if (row) { row.name = val; saveState(); }
    }

    function _updateVarcostPct(id, val) {
        const row = state.varcostRows.find(r => r.id === id);
        if (row) { row.pct = parseFloat(val) || 0; recalculate(); }
    }

    function _updateCapexName(id, val) {
        const row = state.capexRows.find(r => r.id === id);
        if (row) { row.name = val; saveState(); }
    }

    function _updateCapexVal(id, yearIdx, val) {
        const row = state.capexRows.find(r => r.id === id);
        if (row) { row.vals[yearIdx] = parseFloat(val) || 0; recalculate(); }
    }

    function _deleteRow(type, id) {
        if (type === 'revenue') state.revenueRows = state.revenueRows.filter(r => r.id !== id);
        else if (type === 'fixcost') state.fixcostRows = state.fixcostRows.filter(r => r.id !== id);
        else if (type === 'varcost') state.varcostRows = state.varcostRows.filter(r => r.id !== id);
        else if (type === 'capex') state.capexRows = state.capexRows.filter(r => r.id !== id);
        renderAll();
        recalculate();
    }

    function _updateMsCategory(idx, val) { state.milestones[idx].category = val; saveState(); }
    function _updateMsText(idx, val) { state.milestones[idx].text = val; saveState(); }
    function _updateMsYear(idx, val) { state.milestones[idx].year = parseInt(val) || 1; renderMilestones(); saveState(); }
    function _deleteMilestone(idx) { state.milestones.splice(idx, 1); renderMilestones(); saveState(); }

    function _sliderChange(key, val) {
        state[key] = parseFloat(val);
        setText(`slider-val-${key}`, `${val} %`);
        recalculate();
    }

    // ── Helpers ───────────────────────────────────────────────────────

    function findRow(type, id) {
        if (type === 'revenue') return state.revenueRows.find(r => r.id === id);
        if (type === 'fixcost') return state.fixcostRows.find(r => r.id === id);
        return null;
    }

    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // ── Render all input rows (without recalculating) ─────────────────
    function renderAll() {
        renderRevenueRows();
        renderFixcostRows();
        renderVarcostRows();
        renderCapexRows();
        renderMilestones();
        renderGrowthSliders();
    }

    // ── Persist / restore state ───────────────────────────────────────
    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (_) { /* quota exceeded — ignore */ }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            // Merge — keep defaults for any missing keys
            Object.assign(state, saved);
        } catch (_) { /* corrupt data — just use defaults */ }
    }

    // ── CSV Export ────────────────────────────────────────────────────
    function exportCSV() {
        const r = calculate();
        const sep = ';';
        const lines = [];

        const company = document.getElementById('s-company')?.value || 'Plan';
        lines.push(`5-Jahres-Plan${sep}${company}`);
        lines.push(`Szenario${sep}${SCENARIO_LABELS[state.scenario]}`);
        lines.push('');

        const header = ['Position', ...r.years.map(String), 'Gesamt'];
        lines.push(header.join(sep));

        const addRow = (label, vals) => {
            const sum = vals.reduce((a, b) => a + b, 0);
            lines.push([label, ...vals.map(v => v.toFixed(2).replace('.', ',')), sum.toFixed(2).replace('.', ',')].join(sep));
        };

        lines.push('--- EINNAHMEN ---');
        addRow('Gesamtumsatz', r.totalRevenue);
        lines.push('--- AUSGABEN ---');
        addRow('Variable Kosten', r.totalVarcosts);
        addRow('Fixkosten', r.totalFixcosts);
        addRow('Inhabergehalt', r.ownerSalary);
        addRow('Gesamtkosten', r.totalCosts);
        lines.push('--- ERGEBNIS ---');
        addRow('EBITDA', r.ebitda);
        addRow('Zinsen', r.interest);
        addRow('EBIT', r.ebit);
        addRow('Steuern', r.tax);
        addRow('Jahresüberschuss', r.netIncome);
        lines.push('--- CASHFLOW ---');
        addRow('Free Cashflow', r.fcf);
        addRow('Kumulierter FCF', r.cumFcf);
        lines.push('--- FINANZIERUNG ---');
        addRow('Annuität', r.interest.map((v, i) => v + r.repayment[i]));
        addRow('Zinsen', r.interest);
        addRow('Tilgung', r.repayment);
        addRow('Restschuld', r.loanBalance);

        const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `5jahresplan_${(company || 'export').replace(/\s+/g, '_')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Sidebar input listeners (auto-recalc) ─────────────────────────
    function bindSidebar() {
        const ids = ['s-company','s-start-year','s-purchase-price','s-equity','s-debt',
                     's-interest-rate','s-loan-term','s-owner-salary','s-tax-rate'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => recalculate());
        });
    }

    // ── Init ──────────────────────────────────────────────────────────
    function init() {
        loadState();
        renderAll();
        bindSidebar();
        recalculate();
    }

    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── Public exports ─────────────────────────────────────────────────
    return {
        recalculate,
        showTab,
        setScenario,
        addRevenueRow,
        addFixcostRow,
        addVarcostRow,
        addCapexRow,
        addMilestone,
        exportCSV,
        // internal mutators exposed for inline HTML events
        _updateRowName,
        _updateRowBase,
        _updateRowGrowth,
        _updateVarcostName,
        _updateVarcostPct,
        _updateCapexName,
        _updateCapexVal,
        _deleteRow,
        _updateMsCategory,
        _updateMsText,
        _updateMsYear,
        _deleteMilestone,
        _sliderChange,
    };
})();
