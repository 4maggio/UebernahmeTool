/**
 * app.js — Main application controller
 * Manages the 7-step wizard, state, validation, result rendering, PDF export.
 */

const App = (() => {
  const TOTAL_STEPS = 7;

  /* ── State ──────────────────────────────────────────────────────── */
  let state = {
    currentStep: 1,
    sessionId: null,
    lang: 'de',
    data: {
      // Step 1
      companyName: '', website: '', rechtsform: 'gbr', branche: 'ecommerce',
      gruendungsjahr: '', bundesland: '', beschreibung: '',
      verkaeuferrolle: 'alleininhaber', verkaufsmotiv: 'unbekannt',
      // Step 2
      finanzhistorie: [
        { jahr: new Date().getFullYear() - 2, umsatz: null, ebitda: null, inhabergehalt: null },
        { jahr: new Date().getFullYear() - 1, umsatz: null, ebitda: null, inhabergehalt: null },
        { jahr: new Date().getFullYear(),     umsatz: null, ebitda: null, inhabergehalt: null },
      ],
      einmaligkosten: 0, privatnutzung: 0,
      verbindlichkeiten: 0, kassenbestand: 0,
      buchhaltung: 'einnahmen_ausgaben', jahresabschluss: '3_jahre',
      marktgehaltNachfolger: 65000,
      // Step 3
      inventarWert: 0, inventarMarket: 0, inventarMhd: 0,
      maschinen: 0, immobilien: 0,
      domains: 0, domainWert: 0, shopSystem: 'shopify', shopWert: 0,
      instagram: 0, facebook: 0, youtube: 0, tiktok: 0, newsletterAbonnenten: 0,
      kundenanzahl: 0, wiederkaeuferquote: 0, clv: 0, crmVorhanden: 'nein',
      markeEingetragen: 'nein', markeBezeichnung: '', patente: 'nein', lizenzen: '',
      // Step 4
      shopifyPlan: 'shopify', zahlungsanbieter: [],
      anzahlLieferanten: 0, hauptlieferantAbhaengigkeit: 0,
      lieferantenvertraegeUebertragbar: 'unbekannt',
      eigenerShop: 0, amazon: 0, ebay: 0, sonstigeKanaele: 0,
      hostingAnbieter: '', hostingVertragLaufzeit: 0, toolsAbonnements: 0,
      anzahlMitarbeiter: 0, mitarbeiterHauptaufgaben: '',
      // Step 5
      gewerbeanmeldung: 'ja', erlaubnisse: 'keine',
      laufendeKlagen: 'nein', drohendeKlagen: 'nein',
      steuerprüfung: 'nein', steuerprüfungErgebnis: '',
      verborgeneVerbindlichkeiten: '',
      datenschutzbeauftragter: 'nein', datenschutzerklaerung: 'ja', avvVertraege: 'nein',
      sicherheitsvorfall: 'nein', betriebshaftpflicht: 'nein', versicherungsarten: '',
      gesellschaftsvertrag: 'nein', vinkulierungsklausel: 'nein',
      inhaberAbhaengigkeit: 'mittel',
      // Step 6
      marktgroesse: '', markttrend: 'stabil', saisonalitaet: 'keine', saisonHochpunkt: '',
      anzahlWettbewerber: 0, marktanteil: 0, wettbewerbsvorteil: 'nische',
      konkreteWachstumschancen: '', naechsteSchritte: 0, kundenkonzentration: 0,
      // Step 7
      dealStruktur: 'asset_deal', kaufpreisVorstellung: 0, kaufpreisVerhandlungsbasis: 'ja',
      earnOutGewuenscht: 'nein', earnOutDetails: '', verkaeuferdarlehen: 'nein',
      uebergabezeitraum: 'mittel', einarbeitungszeitraum: 6, finanzierungsweg: 'mix_ek_bank',
      alter: 45, buchwertAnteile: 0, bisherFreibetragGenutzt: 'nein',
    },
    result: null,
  };

  /* ── Helpers ────────────────────────────────────────────────────── */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const fmt = (n) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n);
  const fmtCurr = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const t = (key, vars) => I18n.t(key, vars);

  function get(key) { return state.data[key]; }
  function set(key, val) { state.data[key] = val; }

  /* ── Init ───────────────────────────────────────────────────────── */
  async function init() {
    state.lang = localStorage.getItem('lang') || 'de';
    await I18n.init(state.lang);
    I18n.applyDom();
    buildStepNav();
    renderStep(1);
    bindGlobalEvents();
    updateLanguageToggle();
  }

  /* ── Navigation ─────────────────────────────────────────────────── */
  function buildStepNav() {
    const nav = $('#step-nav');
    if (!nav) return;
    nav.innerHTML = '';
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const li = document.createElement('li');
      li.className = 'step-nav-item';
      li.dataset.step = i;
      li.innerHTML = `<span class="step-nav-num">${i}</span><span class="step-nav-label" data-i18n="nav.step${i}"></span>`;
      li.addEventListener('click', () => { if (i < state.currentStep) goToStep(i); });
      nav.appendChild(li);
    }
    I18n.applyDom(nav);
  }

  function updateStepNav() {
    $$('.step-nav-item').forEach(li => {
      const s = parseInt(li.dataset.step, 10);
      li.classList.toggle('active', s === state.currentStep);
      li.classList.toggle('completed', s < state.currentStep);
    });
    const resultTab = $('#nav-result');
    if (resultTab) resultTab.classList.toggle('visible', state.result != null);
  }

  function goToStep(step) {
    if (step < 1 || step > TOTAL_STEPS + 1) return;
    collectCurrentStep();
    state.currentStep = step;
    if (step > TOTAL_STEPS) {
      renderResult();
    } else {
      renderStep(step);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Step Rendering ─────────────────────────────────────────────── */
  function renderStep(step) {
    const container = $('#wizard-content');
    if (!container) return;
    updateStepNav();
    updateProgressBar();

    const html = buildStepHTML(step);
    container.innerHTML = html;
    I18n.applyDom(container);
    populateFormValues(step);
    bindStepEvents(step);
    renderLivePreview();
  }

  function updateProgressBar() {
    const bar = $('#progress-bar-fill');
    const label = $('#progress-label');
    if (bar) bar.style.width = `${((state.currentStep - 1) / TOTAL_STEPS) * 100}%`;
    if (label) label.textContent = `${t('app.step')} ${state.currentStep} ${t('app.of')} ${TOTAL_STEPS}`;
  }

  /* ── Step HTML Builders ─────────────────────────────────────────── */
  function buildStepHTML(step) {
    const builders = { 1: buildStep1, 2: buildStep2, 3: buildStep3, 4: buildStep4, 5: buildStep5, 6: buildStep6, 7: buildStep7 };
    const fn = builders[step];
    if (!fn) return '<p>Unbekannter Schritt</p>';
    const content = fn();
    return `
      <div class="step-container" data-step="${step}">
        <div class="step-header">
          <div class="step-badge">${t('app.step')} ${step}/${TOTAL_STEPS}</div>
          <h2 class="step-title" data-i18n="step${step}.title"></h2>
          <p class="step-desc" data-i18n="step${step}.description"></p>
        </div>
        <div class="step-body">
          ${content}
        </div>
        <div class="step-footer">
          ${step > 1 ? `<button class="btn btn-secondary btn-back" onclick="App.prevStep()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg> <span data-i18n="app.back"></span></button>` : '<div></div>'}
          ${step < TOTAL_STEPS
            ? `<button class="btn btn-primary btn-next" onclick="App.nextStep()"><span data-i18n="app.next"></span> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg></button>`
            : `<button class="btn btn-success btn-calculate" onclick="App.runCalculation()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg> <span data-i18n="app.calculate"></span></button>`
          }
        </div>
      </div>`;
  }

  /* ── Step 1: Unternehmensidentität ─────────────────────────────── */
  function buildStep1() {
    return `
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step1.companyName"></label>
          <input type="text" class="form-input" name="companyName" data-i18n-placeholder="step1.companyNamePlaceholder" required>
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step1.website"></label>
          <input type="url" class="form-input" name="website" data-i18n-placeholder="step1.websitePlaceholder">
        </div>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step1.rechtsform"></label>
          <select class="form-select" name="rechtsform" id="select-rechtsform">
            ${buildOptions('step1.rechtsformOptions', ['gbr','einzelunternehmen','kg','ug','gmbh','gmbh_co_kg','ag'])}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step1.branche"></label>
          <select class="form-select" name="branche">
            ${buildOptions('step1.brancheOptions', ['ecommerce','agrar_handel','saas','dienstleistung','handel','gastronomie','handwerk','produktion','gesundheit','sonstige'])}
          </select>
        </div>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step1.gruendungsjahr"></label>
          <input type="number" class="form-input" name="gruendungsjahr" min="1900" max="${new Date().getFullYear()}" placeholder="z. B. 2019">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step1.bundesland"></label>
          <select class="form-select" name="bundesland">
            ${buildBundeslandOptions()}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" data-i18n="step1.beschreibung"></label>
        <textarea class="form-textarea" name="beschreibung" rows="3" data-i18n-placeholder="step1.beschreibungPlaceholder"></textarea>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step1.verkaeuferrolle"></label>
          <select class="form-select" name="verkaeuferrolle">
            ${buildOptions('step1.verkaeuferrolleOptions', ['alleininhaber','mehrere_gesellschafter','alle_gesellschafter'])}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step1.verkaufsmotiv"></label>
          <select class="form-select" name="verkaufsmotiv">
            ${buildOptions('step1.verkaufsmotivOptions', ['rente','neues_projekt','finanzielle_not','gesundheit','streit','strategisch','unbekannt'])}
          </select>
        </div>
      </div>
      <div id="hinweis-gbr" class="alert alert-info hidden">
        <strong>ℹ️</strong> <span data-i18n="step1.hinweis_gbr"></span>
      </div>`;
  }

  /* ── Step 2: Finanzkennzahlen ───────────────────────────────────── */
  function buildStep2() {
    const jahre = state.data.finanzhistorie;
    return `
      <div class="finance-table-wrapper">
        <table class="finance-table">
          <thead>
            <tr>
              <th data-i18n="step2.jahrLabel"></th>
              ${jahre.map(j => `<th>${j.jahr}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><label data-i18n="step2.umsatz"></label></td>
              ${jahre.map((j, i) => `<td><input type="number" class="form-input form-input-sm" name="fin_umsatz_${i}" min="0" placeholder="0" value="${j.umsatz ?? ''}"></td>`).join('')}
            </tr>
            <tr>
              <td>
                <label data-i18n="step2.ebitda"></label>
                <span class="hint-icon" data-hint="step2.ebitdaHint">?</span>
              </td>
              ${jahre.map((j, i) => `<td><input type="number" class="form-input form-input-sm" name="fin_ebitda_${i}" placeholder="0" value="${j.ebitda ?? ''}"></td>`).join('')}
            </tr>
            <tr>
              <td>
                <label data-i18n="step2.inhabergehalt"></label>
                <span class="hint-icon" data-hint="step2.inhabergehaltHint">?</span>
              </td>
              ${jahre.map((j, i) => `<td><input type="number" class="form-input form-input-sm" name="fin_inhabergehalt_${i}" min="0" placeholder="0" value="${j.inhabergehalt ?? ''}"></td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>

      <div class="form-group">
        <label class="form-label">
          <span data-i18n="step2.marktgehaltNachfolger"></span>
          <span class="hint-icon" data-hint="step2.marktgehaltHint">?</span>
        </label>
        <input type="number" class="form-input" name="marktgehaltNachfolger" min="0" value="65000">
      </div>

      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label">
            <span data-i18n="step2.einmaligkostenLabel"></span>
            <span class="hint-icon" data-hint="step2.einmaligkostenHint">?</span>
          </label>
          <input type="number" class="form-input" name="einmaligkosten" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">
            <span data-i18n="step2.privatnutzungLabel"></span>
            <span class="hint-icon" data-hint="step2.privatnutzungHint">?</span>
          </label>
          <input type="number" class="form-input" name="privatnutzung" min="0" placeholder="0">
        </div>
      </div>

      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label">
            <span data-i18n="step2.verbindlichkeiten"></span>
            <span class="hint-icon" data-hint="step2.verbindlichkeitenHint">?</span>
          </label>
          <input type="number" class="form-input" name="verbindlichkeiten" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step2.kassenbestand"></label>
          <input type="number" class="form-input" name="kassenbestand" min="0" placeholder="0">
        </div>
      </div>

      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step2.buchhaltung"></label>
          <select class="form-select" name="buchhaltung">
            ${buildOptions('step2.buchhaltungOptions', ['einnahmen_ausgaben','bilanz','beides','keine'])}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step2.jahresabschluss"></label>
          <select class="form-select" name="jahresabschluss">
            ${buildOptions('step2.jahresabschlussOptions', ['3_jahre','2_jahre','1_jahr','nein'])}
          </select>
        </div>
      </div>

      <div class="card card-preview" id="norm-ebitda-preview">
        <h4 class="card-title" data-i18n="step2.normalisierungTitle"></h4>
        <p class="hint" data-i18n="step2.normalisierungHint"></p>
        <div id="norm-ebitda-result" class="norm-preview-body"></div>
      </div>`;
  }

  /* ── Step 3: Assets & Substanzwert ─────────────────────────────── */
  function buildStep3() {
    return `
      <h3 class="section-title" data-i18n="step3.inventarTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step3.inventarWert"></label>
          <input type="number" class="form-input" name="inventarWert" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step3.inventarMarket"></label>
          <input type="number" class="form-input" name="inventarMarket" min="0" placeholder="0">
        </div>
      </div>
      <div class="alert alert-warning">
        <strong>⚠️</strong> <span data-i18n="step3.inventarMhdHint"></span>
      </div>
      <div class="form-group">
        <label class="form-label" data-i18n="step3.inventarMhd"></label>
        <div class="range-wrapper">
          <input type="range" class="form-range" name="inventarMhd" min="0" max="100" step="5" value="0">
          <span class="range-value" id="inventarMhd-val">0 %</span>
        </div>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step3.maschinen"></label>
          <input type="number" class="form-input" name="maschinen" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step3.immobilien"></label>
          <input type="number" class="form-input" name="immobilien" min="0" placeholder="0">
        </div>
      </div>

      <h3 class="section-title" data-i18n="step3.digitalTitle"></h3>
      <div class="form-grid form-grid-3">
        <div class="form-group">
          <label class="form-label" data-i18n="step3.domains"></label>
          <input type="number" class="form-input" name="domains" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">
            <span data-i18n="step3.domainWert"></span>
            <span class="hint-icon" data-hint="step3.domainHint">?</span>
          </label>
          <input type="number" class="form-input" name="domainWert" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step3.shopSystem"></label>
          <select class="form-select" name="shopSystem">
            ${buildOptions('step3.shopSystemOptions', ['shopify','woocommerce','magento','shopware','wix','eigen','sonstige'])}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" data-i18n="step3.shopWert"></label>
        <input type="number" class="form-input" name="shopWert" min="0" placeholder="0">
      </div>

      <h3 class="section-title" data-i18n="step3.socialTitle"></h3>
      <p class="hint" data-i18n="step3.socialWertHint"></p>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label" data-i18n="step3.instagram"></label><input type="number" class="form-input" name="instagram" min="0" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step3.facebook"></label><input type="number" class="form-input" name="facebook" min="0" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step3.youtube"></label><input type="number" class="form-input" name="youtube" min="0" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step3.tiktok"></label><input type="number" class="form-input" name="tiktok" min="0" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step3.newsletterAbonnenten"></label><input type="number" class="form-input" name="newsletterAbonnenten" min="0" placeholder="0"></div>
      </div>

      <h3 class="section-title" data-i18n="step3.kundenTitle"></h3>
      <div class="alert alert-warning"><strong>⚠️</strong> <span data-i18n="step3.dsgvoHint"></span></div>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label" data-i18n="step3.kundenanzahl"></label><input type="number" class="form-input" name="kundenanzahl" min="0" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step3.wiederkaeuferquote"></label><input type="number" class="form-input" name="wiederkaeuferquote" min="0" max="100" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step3.clv"></label><input type="number" class="form-input" name="clv" min="0" placeholder="0"></div>
      </div>
      <div class="form-group">
        <label class="form-label" data-i18n="step3.crmVorhanden"></label>
        ${buildYesNo('crmVorhanden')}
      </div>

      <h3 class="section-title" data-i18n="step3.markenTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step3.markeEingetragen"></label>
          ${buildYesNo('markeEingetragen')}
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step3.markeBezeichnung"></label>
          <input type="text" class="form-input" name="markeBezeichnung" placeholder="z. B. budxxl, EU-Marke Nr. 012345">
        </div>
      </div>`;
  }

  /* ── Step 4: Infrastruktur & Verträge ───────────────────────────── */
  function buildStep4() {
    return `
      <h3 class="section-title" data-i18n="step4.shopifyTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step4.shopifyPlan"></label>
          <select class="form-select" name="shopifyPlan">
            ${buildOptions('step4.shopifyPlanOptions', ['basic','shopify','advanced','plus','nicht_shopify'])}
          </select>
        </div>
      </div>
      <div class="alert alert-info"><strong>ℹ️</strong> <span data-i18n="step4.shopifyTransferHint"></span></div>

      <div class="form-group">
        <label class="form-label" data-i18n="step4.zahlungsanbieter"></label>
        <div class="checkbox-group">
          ${['shopify_payments','paypal','klarna','stripe','amazon_pay','sofort'].map(k => `
            <label class="checkbox-label">
              <input type="checkbox" name="zahlungsanbieter" value="${k}">
              <span data-i18n="step4.zahlungsanbieterOptions.${k}"></span>
            </label>`).join('')}
        </div>
      </div>
      <div class="alert alert-warning"><strong>⚠️</strong> <span data-i18n="step4.zahlungsanbieterHint"></span></div>

      <h3 class="section-title" data-i18n="step4.lieferantenTitle"></h3>
      <div class="form-grid form-grid-3">
        <div class="form-group">
          <label class="form-label" data-i18n="step4.anzahlLieferanten"></label>
          <input type="number" class="form-input" name="anzahlLieferanten" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step4.hauptlieferantAbhaengigkeit"></label>
          <input type="number" class="form-input" name="hauptlieferantAbhaengigkeit" min="0" max="100" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step4.lieferantenvertraegeUebertragbar"></label>
          <select class="form-select" name="lieferantenvertraegeUebertragbar">
            ${buildOptions('step4.lieferantenvertraegeUebertragbarOptions', ['ja','teilweise','nein','unbekannt'])}
          </select>
        </div>
      </div>

      <h3 class="section-title" data-i18n="step4.verkaufskanaeleTitle"></h3>
      <p class="hint" data-i18n="step4.kanalHint"></p>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label" data-i18n="step4.eigenerShop"></label><input type="number" class="form-input" name="eigenerShop" min="0" max="100" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step4.amazon"></label><input type="number" class="form-input" name="amazon" min="0" max="100" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step4.ebay"></label><input type="number" class="form-input" name="ebay" min="0" max="100" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step4.sonstigeKanaele"></label><input type="number" class="form-input" name="sonstigeKanaele" min="0" max="100" placeholder="0"></div>
      </div>

      <h3 class="section-title" data-i18n="step4.techStackTitle"></h3>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label" data-i18n="step4.hostingAnbieter"></label><input type="text" class="form-input" name="hostingAnbieter" placeholder="z. B. Hetzner, AWS, Shopify"></div>
        <div class="form-group"><label class="form-label" data-i18n="step4.hostingVertragLaufzeit"></label><input type="number" class="form-input" name="hostingVertragLaufzeit" min="0" placeholder="0"></div>
        <div class="form-group">
          <label class="form-label">
            <span data-i18n="step4.toolsAbonnements"></span>
            <span class="hint-icon" data-hint="step4.toolsAbonnementenHint">?</span>
          </label>
          <input type="number" class="form-input" name="toolsAbonnements" min="0" placeholder="0">
        </div>
      </div>

      <h3 class="section-title" data-i18n="step4.personalTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step4.anzahlMitarbeiter"></label>
          <input type="number" class="form-input" name="anzahlMitarbeiter" min="0" id="input-mitarbeiter" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step4.mitarbeiterHauptaufgaben"></label>
          <input type="text" class="form-input" name="mitarbeiterHauptaufgaben" placeholder="z. B. Lager, Kundenservice">
        </div>
      </div>
      <div id="par613a-warning" class="alert alert-danger hidden">
        <strong>⚠️ § 613a BGB:</strong> <span data-i18n="step4.par613aHinweis"></span>
      </div>`;
  }

  /* ── Step 5: Rechtliches & Compliance ───────────────────────────── */
  function buildStep5() {
    return `
      <h3 class="section-title" data-i18n="step5.gewerbetitel"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step5.gewerbeanmeldung"></label>
          ${buildYesNo('gewerbeanmeldung')}
        </div>
        <div class="form-group">
          <label class="form-label">
            <span data-i18n="step5.erlaubnisse"></span>
            <span class="hint-icon" data-hint="step5.erlaubnisseHint">?</span>
          </label>
          <select class="form-select" name="erlaubnisse">
            ${buildOptions('step5.erlaubnisseOptions', ['keine','erlaubnis_pflicht','lebensmittel','gefahrgut','finanz','sonstige'])}
          </select>
        </div>
      </div>

      <h3 class="section-title" data-i18n="step5.rechtsstreitigkeitenTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label" data-i18n="step5.laufendeKlagen"></label>${buildYesNo('laufendeKlagen')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.drohendeKlagen"></label>${buildYesNo('drohendeKlagen')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.steuerprüfung"></label>${buildYesNo('steuerprüfung')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.steuerprüfungErgebnis"></label><input type="text" class="form-input" name="steuerprüfungErgebnis" placeholder="z. B. Nachzahlung 5.000 €"></div>
      </div>
      <div class="form-group">
        <label class="form-label" data-i18n="step5.verborgeneVerbindlichkeiten"></label>
        <textarea class="form-textarea" name="verborgeneVerbindlichkeiten" rows="2" placeholder="z. B. Altlasten, umstrittene Forderungen…"></textarea>
      </div>

      <h3 class="section-title" data-i18n="step5.dsgvoTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label" data-i18n="step5.datenschutzbeauftragter"></label>${buildYesNo('datenschutzbeauftragter')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.datenschutzerklaerung"></label>${buildYesNo('datenschutzerklaerung')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.avvVertraege"></label>${buildYesNo('avvVertraege')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.sicherheitsvorfall"></label>${buildYesNo('sicherheitsvorfall')}</div>
      </div>

      <h3 class="section-title" data-i18n="step5.versicherungTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label" data-i18n="step5.betriebshaftpflicht"></label>${buildYesNo('betriebshaftpflicht')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.versicherungsarten"></label><input type="text" class="form-input" name="versicherungsarten" placeholder="z. B. Produkthaftpflicht, D&O"></div>
      </div>

      <h3 class="section-title" data-i18n="step5.gesellschaftsvertragTitle"></h3>
      <div class="alert alert-info"><strong>ℹ️</strong> <span data-i18n="step5.gesellschaftsvertragHint"></span></div>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label" data-i18n="step5.gesellschaftsvertrag"></label>${buildYesNo('gesellschaftsvertrag')}</div>
        <div class="form-group"><label class="form-label" data-i18n="step5.vinkulierungsklausel"></label>${buildYesNo('vinkulierungsklausel')}</div>
      </div>

      <h3 class="section-title" data-i18n="step5.abhaengigkeitenTitle"></h3>
      <div class="form-group">
        <label class="form-label" data-i18n="step5.inhaberAbhaengigkeit"></label>
        <select class="form-select" name="inhaberAbhaengigkeit">
          ${buildOptions('step5.inhaberAbhaengigkeitOptions', ['stark','mittel','gering','keine'])}
        </select>
      </div>`;
  }

  /* ── Step 6: Markt & Wettbewerb ─────────────────────────────────── */
  function buildStep6() {
    return `
      <h3 class="section-title" data-i18n="step6.marktTitle"></h3>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label" data-i18n="step6.marktgroesse"></label><input type="number" class="form-input" name="marktgroesse" min="0" placeholder="0"></div>
        <div class="form-group">
          <label class="form-label" data-i18n="step6.markttrend"></label>
          <select class="form-select" name="markttrend">
            ${buildOptions('step6.markttrendOptions', ['stark_wachsend','wachsend','stabil','schrumpfend','unklar'])}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step6.saisonalitaet"></label>
          <select class="form-select" name="saisonalitaet">
            ${buildOptions('step6.saisonalitaetOptions', ['keine','leicht','stark','extrem'])}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" data-i18n="step6.saisonHochpunkt"></label>
        <input type="text" class="form-input" name="saisonHochpunkt" placeholder="z. B. März–Mai, Oktober">
      </div>

      <h3 class="section-title" data-i18n="step6.wettbewerbTitle"></h3>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label" data-i18n="step6.anzahlWettbewerber"></label><input type="number" class="form-input" name="anzahlWettbewerber" min="0" placeholder="0"></div>
        <div class="form-group"><label class="form-label" data-i18n="step6.marktanteil"></label><input type="number" class="form-input" name="marktanteil" min="0" max="100" placeholder="0"></div>
        <div class="form-group">
          <label class="form-label" data-i18n="step6.wettbewerbsvorteil"></label>
          <select class="form-select" name="wettbewerbsvorteil">
            ${buildOptions('step6.wettbewerbsvorteilOptions', ['preis','qualitaet','service','nische','marke','technologie','vertrieb','gemeinschaft','sonstige'])}
          </select>
        </div>
      </div>

      <h3 class="section-title" data-i18n="step6.wachstumspotenzialTitle"></h3>
      <div class="form-group">
        <label class="form-label" data-i18n="step6.konkreteWachstumschancen"></label>
        <textarea class="form-textarea" name="konkreteWachstumschancen" rows="2" placeholder="z. B. D2C-Expansion in EU, B2B-Segment, Private Label…"></textarea>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label" data-i18n="step6.naechsteSchritte"></label><input type="number" class="form-input" name="naechsteSchritte" min="0" placeholder="0"></div>
        <div class="form-group">
          <label class="form-label">
            <span data-i18n="step6.kundenkonzentration"></span>
            <span class="hint-icon" data-hint="step6.kundenkonzentrationHint">?</span>
          </label>
          <div class="range-wrapper">
            <input type="range" class="form-range" name="kundenkonzentration" min="0" max="100" step="5" value="0">
            <span class="range-value" id="kundenkonz-val">0 %</span>
          </div>
        </div>
      </div>`;
  }

  /* ── Step 7: Transaktion & Steuer ───────────────────────────────── */
  function buildStep7() {
    return `
      <h3 class="section-title" data-i18n="step7.dealStrukturTitle"></h3>
      <div class="form-group">
        <label class="form-label" data-i18n="step7.dealStruktur"></label>
        <select class="form-select" name="dealStruktur" id="select-dealstruktur">
          ${buildOptions('step7.dealStrukturOptions', ['asset_deal','share_deal','noch_offen'])}
        </select>
      </div>
      <div id="deal-gbr-hint" class="alert alert-info hidden">
        <strong>ℹ️</strong> <span data-i18n="step7.dealStrukturGbrHint"></span>
      </div>
      <div id="par613a-full-warning" class="alert alert-danger hidden">
        <h4>⚠️ § 613a BGB — Betriebsübergang</h4>
        <p data-i18n="step7.par613aWarning"></p>
      </div>

      <h3 class="section-title" data-i18n="step7.kaufpreisTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step7.kaufpreisVorstellung"></label>
          <input type="number" class="form-input" name="kaufpreisVorstellung" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step7.kaufpreisVerhandlungsbasis"></label>
          ${buildYesNo('kaufpreisVerhandlungsbasis')}
        </div>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step7.earnOutGewuenscht"></label>
          ${buildYesNo('earnOutGewuenscht')}
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step7.verkaeuferdarlehen"></label>
          ${buildYesNo('verkaeuferdarlehen')}
        </div>
      </div>
      <div class="form-group" id="earnout-details-row">
        <label class="form-label" data-i18n="step7.earnOutDetails"></label>
        <input type="text" class="form-input" name="earnOutDetails" placeholder="z. B. 10 % Umsatzbeteiligung über 2 Jahre">
      </div>

      <h3 class="section-title" data-i18n="step7.uebergabeTitle"></h3>
      <div class="form-grid form-grid-2">
        <div class="form-group">
          <label class="form-label" data-i18n="step7.uebergabezeitraum"></label>
          <select class="form-select" name="uebergabezeitraum">
            ${buildOptions('step7.uebergabezeitraumOptions', ['sofort','kurz','mittel','lang'])}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step7.einarbeitungszeitraum"></label>
          <input type="number" class="form-input" name="einarbeitungszeitraum" min="0" max="24" placeholder="6">
        </div>
      </div>

      <h3 class="section-title" data-i18n="step7.finanzierungTitle"></h3>
      <div class="form-group">
        <label class="form-label" data-i18n="step7.finanzierungsweg"></label>
        <select class="form-select" name="finanzierungsweg">
          ${buildOptions('step7.finanzierungswegOptions', ['eigenkapital','bankkredit','kfw','mix_ek_bank','mix_ek_bank_kfw','foerderung','investor','noch_offen'])}
        </select>
      </div>
      <div id="kfw-hint" class="alert alert-info hidden">
        <strong>ℹ️</strong> <span data-i18n="step7.kfwHint"></span>
      </div>

      <h3 class="section-title" data-i18n="step7.steuerTitle"></h3>
      <div class="alert alert-warning"><strong>⚠️</strong> <span data-i18n="step7.steuerHinweis"></span></div>
      <div class="form-grid form-grid-3">
        <div class="form-group">
          <label class="form-label" data-i18n="step7.verkaeufersAlter"></label>
          <input type="number" class="form-input" name="alter" min="18" max="99" placeholder="45">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step7.buchwertAnteile"></label>
          <input type="number" class="form-input" name="buchwertAnteile" min="0" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label" data-i18n="step7.bisherFreibetragGenutzt"></label>
          ${buildYesNo('bisherFreibetragGenutzt')}
        </div>
      </div>`;
  }

  /* ── Form Helpers ───────────────────────────────────────────────── */
  function buildOptions(i18nBase, keys) {
    return keys.map(k => `<option value="${k}">${t(`${i18nBase}.${k}`) || k}</option>`).join('');
  }

  function buildYesNo(name) {
    return `
      <div class="radio-group">
        <label class="radio-label"><input type="radio" name="${name}" value="ja"> <span data-i18n="app.yes"></span></label>
        <label class="radio-label"><input type="radio" name="${name}" value="nein"> <span data-i18n="app.no"></span></label>
      </div>`;
  }

  function buildBundeslandOptions() {
    const laender = ['Baden-Württemberg','Bayern','Berlin','Brandenburg','Bremen','Hamburg','Hessen','Mecklenburg-Vorpommern','Niedersachsen','Nordrhein-Westfalen','Rheinland-Pfalz','Saarland','Sachsen','Sachsen-Anhalt','Schleswig-Holstein','Thüringen'];
    return `<option value="">— Bitte wählen —</option>` + laender.map(l => `<option value="${l}">${l}</option>`).join('');
  }

  /* ── Populate form values from state ────────────────────────────── */
  function populateFormValues(step) {
    const container = $('#wizard-content');
    if (!container) return;
    container.querySelectorAll('[name]').forEach(el => {
      const name = el.getAttribute('name');
      if (name.startsWith('fin_')) {
        // Finance table: fin_umsatz_0, fin_ebitda_1, etc.
        const parts = name.split('_');
        const key = parts[1]; // umsatz | ebitda | inhabergehalt
        const idx = parseInt(parts[2], 10);
        const val = state.data.finanzhistorie[idx]?.[key];
        if (val != null) el.value = val;
      } else if (el.type === 'checkbox' && name === 'zahlungsanbieter') {
        el.checked = (state.data.zahlungsanbieter || []).includes(el.value);
      } else if (el.type === 'radio') {
        el.checked = (String(state.data[name]) === String(el.value));
      } else if (name in state.data) {
        el.value = state.data[name] ?? '';
      }
    });
    // Update range displays
    updateRangeDisplay('inventarMhd', 'inventarMhd-val', '%');
    updateRangeDisplay('kundenkonzentration', 'kundenkonz-val', '%');
    // Conditional visibility
    if (step === 1) toggleGbrHint();
    if (step === 4) togglePar613aWarning();
    if (step === 7) { updateDealStrukturUI(); updateFinanzierungUI(); }
  }

  function updateRangeDisplay(inputName, displayId, suffix) {
    const input = $(`[name="${inputName}"]`);
    const disp = $(`#${displayId}`);
    if (input && disp) {
      disp.textContent = `${input.value} ${suffix}`;
      input.addEventListener('input', () => { disp.textContent = `${input.value} ${suffix}`; });
    }
  }

  /* ── Collect form values into state ─────────────────────────────── */
  function collectCurrentStep() {
    const container = $('#wizard-content');
    if (!container) return;
    container.querySelectorAll('[name]').forEach(el => {
      const name = el.getAttribute('name');
      const rawVal = el.value;
      const numVal = parseFloat(rawVal);

      if (name.startsWith('fin_')) {
        const parts = name.split('_');
        const key = parts[1];
        const idx = parseInt(parts[2], 10);
        if (state.data.finanzhistorie[idx]) {
          state.data.finanzhistorie[idx][key] = isNaN(numVal) ? null : numVal;
        }
        return;
      }

      if (el.type === 'checkbox' && name === 'zahlungsanbieter') {
        if (!Array.isArray(state.data.zahlungsanbieter)) state.data.zahlungsanbieter = [];
        if (el.checked) {
          if (!state.data.zahlungsanbieter.includes(el.value)) state.data.zahlungsanbieter.push(el.value);
        } else {
          state.data.zahlungsanbieter = state.data.zahlungsanbieter.filter(v => v !== el.value);
        }
        return;
      }

      if (el.type === 'radio' && !el.checked) return;

      // Numeric fields
      const numericFields = ['inventarWert','inventarMarket','inventarMhd','maschinen','immobilien',
        'domains','domainWert','shopWert','instagram','facebook','youtube','tiktok','newsletterAbonnenten',
        'kundenanzahl','wiederkaeuferquote','clv',
        'anzahlLieferanten','hauptlieferantAbhaengigkeit','eigenerShop','amazon','ebay','sonstigeKanaele',
        'hostingVertragLaufzeit','toolsAbonnements','anzahlMitarbeiter',
        'marktgroesse','anzahlWettbewerber','marktanteil','naechsteSchritte','kundenkonzentration',
        'kaufpreisVorstellung','einarbeitungszeitraum',
        'alter','buchwertAnteile',
        'einmaligkosten','privatnutzung','verbindlichkeiten','kassenbestand','marktgehaltNachfolger'];

      if (numericFields.includes(name)) {
        state.data[name] = isNaN(numVal) ? 0 : numVal;
      } else {
        state.data[name] = rawVal;
      }
    });
  }

  /* ── Conditional UI Logic ───────────────────────────────────────── */
  function toggleGbrHint() {
    const hint = $('#hinweis-gbr');
    if (!hint) return;
    const rf = get('rechtsform');
    hint.classList.toggle('hidden', !['gbr','einzelunternehmen','kg'].includes(rf));
  }

  function togglePar613aWarning() {
    const warn = $('#par613a-warning');
    if (!warn) return;
    warn.classList.toggle('hidden', parseInt(get('anzahlMitarbeiter') || 0, 10) === 0);
  }

  function updateDealStrukturUI() {
    const gbrHint = $('#deal-gbr-hint');
    const par613aFull = $('#par613a-full-warning');
    const rf = get('rechtsform');
    const ds = get('dealStruktur');
    const ma = parseInt(get('anzahlMitarbeiter') || 0, 10);

    if (gbrHint) {
      gbrHint.classList.toggle('hidden', !(['gbr','einzelunternehmen','kg'].includes(rf) && ds === 'share_deal'));
    }
    if (par613aFull) {
      par613aFull.classList.toggle('hidden', !(ds === 'asset_deal' && ma > 0));
    }
  }

  function updateFinanzierungUI() {
    const hint = $('#kfw-hint');
    if (!hint) return;
    const fw = get('finanzierungsweg');
    hint.classList.toggle('hidden', !['kfw','mix_ek_bank_kfw'].includes(fw));
  }

  /* ── Live Preview (EBITDA Normalization) ────────────────────────── */
  function renderLivePreview() {
    const container = $('#norm-ebitda-result');
    if (!container) return;

    collectCurrentStep();
    const latestYear = state.data.finanzhistorie.find(j => j.umsatz > 0 || j.ebitda > 0);
    if (!latestYear) {
      container.innerHTML = `<p class="hint">— Bitte Finanzdaten eingeben —</p>`;
      return;
    }

    const norm = ValuationEngine.normalizeEBITDA({
      ebitda: state.data.finanzhistorie.reduce((s, j) => s + (j.ebitda || 0), 0) / Math.max(1, state.data.finanzhistorie.filter(j => j.ebitda).length),
      inhabergehalt: state.data.finanzhistorie.reduce((s, j) => s + (j.inhabergehalt || 0), 0) / Math.max(1, state.data.finanzhistorie.filter(j => j.inhabergehalt).length),
      marktgehaltNachfolger: state.data.marktgehaltNachfolger || 65000,
      einmaligkosten: state.data.einmaligkosten || 0,
      privatnutzung: state.data.privatnutzung || 0,
    });

    const rows = [
      { label: 'Ø EBITDA (Ausgangsbasis)', val: norm.base, cls: '' },
      { label: '+ Überschuss Inhabergehalt', val: norm.plusExcessOwnerSalary, cls: 'positive' },
      { label: '+ Einmalige Kosten', val: norm.plusEinmaligkosten, cls: 'positive' },
      { label: '+ Privatnutzung Assets', val: norm.plusPrivatnutzung, cls: 'positive' },
      { label: '− Marktgehalt Nachfolger', val: -norm.minusMarktgehalt, cls: 'negative' },
    ];

    container.innerHTML = `
      <table class="norm-table">
        <tbody>
          ${rows.map(r => `<tr><td>${r.label}</td><td class="num ${r.cls}">${fmtCurr(r.val)}</td></tr>`).join('')}
          <tr class="norm-total"><td><strong>= Normalisiertes EBITDA</strong></td><td class="num ${norm.normalized >= 0 ? 'positive' : 'negative'}"><strong>${fmtCurr(norm.normalized)}</strong></td></tr>
        </tbody>
      </table>`;
  }

  /* ── Step Events ────────────────────────────────────────────────── */
  function bindStepEvents(step) {
    const container = $('#wizard-content');
    if (!container) return;

    // Rechtsform change → GbR hint
    const selectRechtsform = $('#select-rechtsform');
    if (selectRechtsform) {
      selectRechtsform.addEventListener('change', () => {
        set('rechtsform', selectRechtsform.value);
        toggleGbrHint();
      });
    }

    // Mitarbeiter change → § 613a warning
    const inputMitarbeiter = $('#input-mitarbeiter');
    if (inputMitarbeiter) {
      inputMitarbeiter.addEventListener('input', () => {
        set('anzahlMitarbeiter', parseInt(inputMitarbeiter.value, 10) || 0);
        togglePar613aWarning();
      });
    }

    // Deal Struktur change
    const selectDeal = $('#select-dealstruktur');
    if (selectDeal) {
      selectDeal.addEventListener('change', () => {
        set('dealStruktur', selectDeal.value);
        updateDealStrukturUI();
      });
    }

    // Finanzierungs change → KfW hint
    container.querySelectorAll('[name="finanzierungsweg"]').forEach(el => {
      el.addEventListener('change', () => {
        set('finanzierungsweg', el.value);
        updateFinanzierungUI();
      });
    });

    // Finance table live preview
    container.querySelectorAll('[name^="fin_"], [name="marktgehaltNachfolger"], [name="einmaligkosten"], [name="privatnutzung"]').forEach(el => {
      el.addEventListener('input', renderLivePreview);
    });

    // Hint tooltips
    container.querySelectorAll('.hint-icon').forEach(icon => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        const hintKey = icon.dataset.hint;
        showTooltip(icon, t(hintKey));
      });
    });

    // Range inputs
    container.querySelectorAll('.form-range').forEach(range => {
      range.addEventListener('input', () => {
        const displayId = range.name + '-val';
        const el = document.getElementById(displayId);
        if (el) el.textContent = `${range.value} %`;
      });
    });
  }

  function showTooltip(anchor, text) {
    // Remove existing
    const existing = document.querySelector('.tooltip-popup');
    if (existing) { existing.remove(); return; }
    const div = document.createElement('div');
    div.className = 'tooltip-popup';
    div.textContent = text;
    const rect = anchor.getBoundingClientRect();
    div.style.top = `${rect.bottom + window.scrollY + 8}px`;
    div.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(div);
    setTimeout(() => {
      document.addEventListener('click', () => div.remove(), { once: true });
    }, 10);
  }

  /* ── Navigation Actions ─────────────────────────────────────────── */
  function nextStep() {
    if (state.currentStep < TOTAL_STEPS) {
      collectCurrentStep();
      goToStep(state.currentStep + 1);
    }
  }

  function prevStep() {
    if (state.currentStep > 1) {
      collectCurrentStep();
      goToStep(state.currentStep - 1);
    }
  }

  /* ── Calculation ─────────────────────────────────────────────────── */
  async function runCalculation() {
    collectCurrentStep();
    const container = $('#wizard-content');
    if (container) {
      container.innerHTML = `<div class="loading-screen"><div class="spinner"></div><p data-i18n="app.loading"></p></div>`;
      I18n.applyDom(container);
    }

    try {
      // Try backend first, fall back to client-side
      let result;
      try {
        const { sessionId } = await API.createSession(state.data);
        state.sessionId = sessionId;
        result = await API.calculateValuation(sessionId);
      } catch (apiErr) {
        console.warn('[App] Backend unavailable, using client-side calculation:', apiErr.message);
        result = ValuationEngine.calculate(state.data);
      }

      state.result = result;
      renderResult();
    } catch (err) {
      console.error('[App] Calculation failed:', err);
      if (container) container.innerHTML = `<div class="alert alert-danger"><strong>Fehler:</strong> ${err.message}</div>`;
    }
  }

  /* ── Result Rendering ───────────────────────────────────────────── */
  function renderResult() {
    const main = document.getElementById('main-content');
    if (!main) return;

    const r = state.result;
    if (!r) { runCalculation(); return; }

    updateStepNav();
    const warnings = ValuationEngine.generateWarnings(state.data);

    main.innerHTML = `
      <div class="result-container" id="print-section">
        <div class="result-header">
          <h1 data-i18n="result.title"></h1>
          <p class="result-company">${state.data.companyName || '—'}</p>
          <p class="result-date">${new Date().toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <div class="alert alert-info result-disclaimer" data-i18n="result.disclaimer"></div>

        ${renderWarnings(warnings)}

        <div class="result-grid">
          ${renderValuationCard(r)}
          ${renderRisikoCard(r)}
          ${renderNormEBITDACard(r)}
          ${renderMethodsCard(r)}
          ${renderTaxCard(r)}
        </div>

        ${renderChecklist()}
        ${renderRecommendations(r, warnings)}
        ${renderNextSteps()}

        <div class="result-actions no-print">
          <button class="btn btn-primary" onclick="App.exportPDF()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span data-i18n="result.exportPdf"></span>
          </button>
          <button class="btn btn-secondary" onclick="App.startNew()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.05"/></svg>
            <span data-i18n="result.neueAnalyse"></span>
          </button>
        </div>
      </div>`;

    I18n.applyDom(main);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderValuationCard(r) {
    const range = r.range || {};
    return `
      <div class="result-card result-card-featured">
        <h3 data-i18n="result.bewertungsübersichtTitle"></h3>
        <div class="valuation-range">
          <div class="range-low">${fmtCurr(range.low || 0)}</div>
          <div class="range-arrow">
            <div class="range-mid">${fmtCurr(range.mid || 0)}</div>
            <div class="range-label" data-i18n="result.gewichteterWert"></div>
          </div>
          <div class="range-high">${fmtCurr(range.high || 0)}</div>
        </div>
        <div class="valuation-band">
          <div class="band-fill" style="left: 0; right: 0;"></div>
        </div>
      </div>`;
  }

  function renderRisikoCard(r) {
    const risiko = r.risiko || {};
    const score = risiko.score || 0;
    const cls = score >= 20 ? 'success' : score >= 0 ? 'warning' : 'danger';
    const risikoFaktoren = risiko.risikoFaktoren || [];
    const positivFaktoren = risiko.positivFaktoren || [];
    return `
      <div class="result-card">
        <h3 data-i18n="result.risikoTitle"></h3>
        <div class="risiko-score risiko-${cls}">
          <span class="risiko-num">${score > 0 ? '+' : ''}${score}</span>
          <span class="risiko-label">${risiko.label || '—'}</span>
        </div>
        ${positivFaktoren.length ? `
          <h4 data-i18n="result.positivFaktoren"></h4>
          <ul class="factor-list factor-positive">
            ${positivFaktoren.map(f => `<li>+${f.delta}% — ${t('warnings.' + f.key) || f.key}</li>`).join('')}
          </ul>` : ''}
        ${risikoFaktoren.length ? `
          <h4 data-i18n="result.risikoFaktoren"></h4>
          <ul class="factor-list factor-negative">
            ${risikoFaktoren.map(f => `<li>${f.delta}% — ${t('warnings.' + f.key) || f.key}</li>`).join('')}
          </ul>` : ''}
      </div>`;
  }

  function renderNormEBITDACard(r) {
    const norm = r.normEBITDA || {};
    return `
      <div class="result-card">
        <h3 data-i18n="result.normEbitdaTitle"></h3>
        <table class="norm-table">
          <tbody>
            <tr><td>Ø EBITDA (Basis)</td><td class="num">${fmtCurr(norm.base || 0)}</td></tr>
            <tr><td>+ Überschuss Inhabergehalt</td><td class="num positive">${fmtCurr(norm.plusExcessOwnerSalary || 0)}</td></tr>
            <tr><td>+ Einmalige Kosten</td><td class="num positive">${fmtCurr(norm.plusEinmaligkosten || 0)}</td></tr>
            <tr><td>+ Privatnutzung</td><td class="num positive">${fmtCurr(norm.plusPrivatnutzung || 0)}</td></tr>
            <tr><td>− Marktgehalt Nachfolger</td><td class="num negative">−${fmtCurr(norm.minusMarktgehalt || 0)}</td></tr>
            <tr class="norm-total"><td><strong>= Normalisiertes EBITDA</strong></td><td class="num ${(norm.normalized || 0) >= 0 ? 'positive' : 'negative'}"><strong>${fmtCurr(norm.normalized || 0)}</strong></td></tr>
          </tbody>
        </table>
      </div>`;
  }

  function renderMethodsCard(r) {
    const methods = r.methods || {};
    const weights = r.weights || {};
    const methodNames = {
      substanzwert: 'result.substanzwert',
      ertragswert: 'result.ertragswert',
      ebitdaMultiple: 'result.ebitdaMultiple',
      umsatzMultiple: 'result.umsatzMultiple',
      dcf: 'result.dcf',
    };
    return `
      <div class="result-card">
        <h3 data-i18n="result.methoden"></h3>
        <table class="methods-table">
          <thead><tr><th>Methode</th><th>Wert</th><th>Gewicht</th></tr></thead>
          <tbody>
            ${Object.entries(methods).map(([key, val]) => {
              const w = weights[key];
              if (!w) return '';
              return `<tr>
                <td data-i18n="${methodNames[key] || key}"></td>
                <td class="num">${fmtCurr(val)}</td>
                <td class="num">${Math.round(w * 100)}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderTaxCard(r) {
    const tax = r.tax || {};
    if (!tax.verauesserungsgewinn) return '<div class="result-card"><h3 data-i18n="result.steuerTitle"></h3><p>— Keine Steuerdaten —</p></div>';
    return `
      <div class="result-card">
        <h3 data-i18n="result.steuerTitle"></h3>
        <div class="alert alert-warning" data-i18n="result.steuerDisclaimer"></div>
        <table class="tax-table">
          <tbody>
            <tr><td data-i18n="result.verauesserungsgewinn"></td><td class="num">${fmtCurr(tax.verauesserungsgewinn)}</td></tr>
            ${tax.freibetrag > 0 ? `<tr class="positive"><td data-i18n="result.freibetrag"></td><td class="num">−${fmtCurr(tax.freibetrag)}</td></tr>` : ''}
            <tr><td>zu versteuernder Gewinn</td><td class="num">${fmtCurr(tax.zvE || tax.verauesserungsgewinn)}</td></tr>
            <tr class="tax-total"><td><strong data-i18n="result.steuerBelastungGeschaetzt"></strong></td><td class="num negative"><strong>≈ ${fmtCurr(tax.steuer || 0)}</strong></td></tr>
          </tbody>
        </table>
        ${tax.note ? `<p class="hint">${tax.note}</p>` : ''}
      </div>`;
  }

  function renderWarnings(warnings) {
    if (!warnings.length) return '';
    const html = warnings.map(w => {
      const cls = w.level === 'danger' ? 'danger' : w.level === 'warning' ? 'warning' : 'info';
      return `<div class="alert alert-${cls}">${t('warnings.' + w.key) || w.key}</div>`;
    }).join('');
    return `<div class="result-warnings">${html}</div>`;
  }

  function renderChecklist() {
    // Static checklist based on context — dynamic version loads from API
    const rf = get('rechtsform');
    const ds = get('dealStruktur');
    const ma = parseInt(get('anzahlMitarbeiter') || 0, 10);

    const items = [
      { phase: 'Vorbereitung', kat: 'Finanziell', text: '3 Jahresabschlüsse / EÜR anfordern' },
      { phase: 'Vorbereitung', kat: 'Rechtlich', text: 'Gesellschaftsvertrag (bzw. Gewerbeanmeldung) prüfen' },
      { phase: 'Vorbereitung', kat: 'Steuerlich', text: 'Letzten Steuerbescheid einsehen' },
      { phase: 'Due Diligence', kat: 'Finanziell', text: 'EBITDA-Normalisierung verifizieren' },
      { phase: 'Due Diligence', kat: 'Finanziell', text: 'Offene Forderungen und Verbindlichkeiten prüfen' },
      { phase: 'Due Diligence', kat: 'Rechtlich', text: 'Laufende Verträge auf Übertragbarkeit prüfen' },
      { phase: 'Due Diligence', kat: 'Technisch', text: 'Shopify Store-Zugänge und Apps dokumentieren' },
      { phase: 'Due Diligence', kat: 'Technisch', text: 'Zahlungsanbieter: neue Konten beim Käufer einrichten' },
      { phase: 'Due Diligence', kat: 'Operativ', text: 'Lagerbestand (inkl. MHD) physisch prüfen' },
      ...(ma > 0 ? [
        { phase: 'Due Diligence', kat: 'Personal', text: 'Arbeitsverträge aller Mitarbeiter sichten' },
        { phase: 'Due Diligence', kat: 'Personal', text: '§ 613a BGB Unterrichtungsschreiben vorbereiten' },
      ] : []),
      { phase: 'Due Diligence', kat: 'Steuerlich', text: 'Betriebsprüfung-Status bestätigen' },
      { phase: 'Verhandlung', kat: 'Rechtlich', text: 'Letter of Intent (LOI) unterzeichnen' },
      { phase: 'Verhandlung', kat: 'Finanziell', text: 'Kaufpreis-Mechanismus festlegen (Locked Box / Completion Accounts)' },
      { phase: 'Abschluss', kat: 'Rechtlich', text: ds === 'asset_deal' ? 'Kaufvertrag über Assets notariell / anwaltlich aufsetzen' : 'Anteilskaufvertrag (SPA) notariell beurkunden' },
      { phase: 'Abschluss', kat: 'Steuerlich', text: 'Steuerberater für finale Kaufpreisstrukturierung einschalten' },
      { phase: 'Abschluss', kat: 'Operativ', text: 'Shopify Store-Eigentümer wechseln' },
      { phase: 'Abschluss', kat: 'Operativ', text: 'Domains übertragen (EPP-Code / DNS-Wechsel)' },
    ];

    const grouped = {};
    items.forEach(item => {
      if (!grouped[item.phase]) grouped[item.phase] = [];
      grouped[item.phase].push(item);
    });

    return `
      <div class="checklist-section">
        <h2 data-i18n="result.checklistenTitle"></h2>
        ${Object.entries(grouped).map(([phase, phaseItems]) => `
          <div class="checklist-phase">
            <h3>${phase}</h3>
            <ul class="checklist">
              ${phaseItems.map(item => `
                <li class="checklist-item">
                  <input type="checkbox" id="chk-${Math.random().toString(36).slice(2)}">
                  <span class="checklist-badge checklist-kat-${item.kat.toLowerCase()}">${item.kat}</span>
                  <span>${item.text}</span>
                </li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>`;
  }

  function renderRecommendations(r, warnings) {
    const recs = [];
    const { rechtsform, jahresabschluss, inhaberAbhaengigkeit, markttrend,
            zahlungsanbieter = [], amazon = 0, ebay = 0, markeEingetragen } = state.data;

    const range = r.range || {};
    const vp = parseFloat(state.data.kaufpreisVorstellung || 0);
    if (vp > 0 && range.mid > 0) {
      const diff = vp / range.mid;
      if (diff > 1.3) recs.push({ level: 'danger', text: `Kaufpreisvorstellung (${fmtCurr(vp)}) liegt ~${Math.round((diff-1)*100)}% über dem errechneten Wert (${fmtCurr(range.mid)}). Starke Nachverhandlung empfohlen.` });
      else if (diff < 0.7) recs.push({ level: 'info', text: `Kaufpreisvorstellung (${fmtCurr(vp)}) liegt ~${Math.round((1-diff)*100)}% unter dem errechneten Wert — mögliche Schnäppchengelegenheit, Due Diligence intensivieren.` });
    }
    if (inhaberAbhaengigkeit === 'stark') recs.push({ level: 'warning', text: 'Hohe Inhaberabhängigkeit: Earnout-Struktur oder längere Einarbeitungsphase (12+ Monate) empfehlen sich.' });
    if (jahresabschluss === 'nein') recs.push({ level: 'danger', text: 'Keine Jahresabschlüsse vorhanden: Externe Buchführung beauftragen und retrograde Abschlüsse erstellen lassen vor Due Diligence.' });
    if (['gbr','einzelunternehmen'].includes(rechtsform) && state.data.dealStruktur === 'share_deal') recs.push({ level: 'danger', text: 'Share Deal bei GbR nicht möglich — auf Asset Deal umstrukturieren!' });
    if (zahlungsanbieter.includes('shopify_payments') || amazon > 0 || ebay > 0) recs.push({ level: 'warning', text: 'Marketplace- und Payment-Konten (Shopify Payments, Amazon, eBay) können nicht übertragen werden. Frühzeitig neue Konten beim Käufer beantragen.' });
    if (markeEingetragen !== 'ja') recs.push({ level: 'info', text: 'Eingetragene Marke fehlt: Markeninhaber-Wechsel nach Übernahme prüfen / Neuanmeldung beim DPMA erwägen.' });
    if (markttrend === 'wachsend' || markttrend === 'stark_wachsend') recs.push({ level: 'success', text: 'Wachsender Markt: Guter Zeitpunkt für Übernahme. Wachstumsinitiativen frühzeitig planen.' });

    if (!recs.length) return '';
    return `
      <div class="recommendations-section">
        <h2 data-i18n="result.empfehlungenTitle"></h2>
        ${recs.map(rec => `<div class="alert alert-${rec.level}">${rec.text}</div>`).join('')}
      </div>`;
  }

  function renderNextSteps() {
    return `
      <div class="next-steps-section">
        <h2 data-i18n="result.naechsteSchritteTitle"></h2>
        <ol class="next-steps-list">
          <li>Steuerberater und M&A-Anwalt mit Due Diligence beauftragen</li>
          <li>Vollständige Unterlagen vom Verkäufer anfordern (Jahresabschlüsse, Verträge, Inventarliste)</li>
          <li>Letter of Intent (LOI) ausarbeiten und Exklusivitätsfrist vereinbaren</li>
          <li>Finanzierung sichern (Bankgespräch, ggf. KfW-Antrag über Hausbank)</li>
          <li>Kaufvertrag durch Fachanwalt für Gesellschaftsrecht aufsetzen lassen</li>
          <li>Übergabeplan erstellen (Shopify, Domains, Lieferanten, ggf. § 613a)</li>
          <li>Gewerbeanmeldung für Käufer vorbereiten</li>
        </ol>
      </div>`;
  }

  /* ── PDF Export ─────────────────────────────────────────────────── */
  function exportPDF() {
    window.print();
  }

  /* ── New Analysis ────────────────────────────────────────────────── */
  function startNew() {
    if (!confirm('Neue Analyse starten? Alle eingegebenen Daten gehen verloren.')) return;
    location.reload();
  }

  /* ── Language Toggle ─────────────────────────────────────────────── */
  async function toggleLanguage() {
    const newLang = state.lang === 'de' ? 'en' : 'de';
    state.lang = newLang;
    I18n.setLang(newLang);
    await I18n.init(newLang);
    updateLanguageToggle();
    if (state.result) {
      renderResult();
    } else {
      renderStep(state.currentStep);
    }
    I18n.applyDom();
  }

  function updateLanguageToggle() {
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = state.lang === 'de' ? '🇬🇧 EN' : '🇩🇪 DE';
  }

  /* ── Global Events ───────────────────────────────────────────────── */
  function bindGlobalEvents() {
    const langBtn = document.getElementById('lang-toggle');
    if (langBtn) langBtn.addEventListener('click', toggleLanguage);

    // Result nav tab
    const resultTab = document.getElementById('nav-result');
    if (resultTab) resultTab.addEventListener('click', () => { if (state.result) renderResult(); });
  }

  return {
    init,
    nextStep,
    prevStep,
    goToStep,
    runCalculation,
    exportPDF,
    startNew,
    toggleLanguage,
    getState: () => state,
  };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
