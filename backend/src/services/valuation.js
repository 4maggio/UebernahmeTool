'use strict';

/**
 * BEWERTUNGS-ENGINE
 * Implementiert alle 4 Bewertungsmethoden plus EBITDA-Normalisierung,
 * Risiko-Scoring und finale Kaufpreisempfehlung.
 *
 * Quellen:
 *  - IDW S1 (Grundsätze zur Unternehmensbewertung)
 *  - § 199–203 BewG (Vereinfachtes Ertragswertverfahren)
 *  - § 16, § 34 EStG (Veräußerungsgewinn, Tarifbegünstigung)
 *  - BVK/Bundesbank Branchenmultiplikatoren (Stand 2025)
 */

const db = require('../db');

// ─────────────────────────────────────────────────────────
//  Branchenmultiplikatoren (Fallback wenn DB-Eintrag fehlt)
// ─────────────────────────────────────────────────────────
const DEFAULT_MULTIPLIERS = {
  ecommerce:        { ebitda: { min: 2.0, max: 5.0, median: 3.5 }, revenue: { min: 0.4, max: 1.2, median: 0.7 } },
  agrar_handel:     { ebitda: { min: 2.0, max: 4.0, median: 3.0 }, revenue: { min: 0.2, max: 0.5, median: 0.35 } },
  saas:             { ebitda: { min: 8.0, max: 20.0, median: 12.0 }, revenue: { min: 3.0, max: 8.0, median: 5.0 } },
  dienstleistung:   { ebitda: { min: 3.0, max: 6.0, median: 4.5 }, revenue: { min: 0.5, max: 1.0, median: 0.7 } },
  handel_offline:   { ebitda: { min: 2.0, max: 4.0, median: 3.0 }, revenue: { min: 0.2, max: 0.5, median: 0.35 } },
  gastronomie:      { ebitda: { min: 2.0, max: 5.0, median: 3.5 }, revenue: { min: 0.3, max: 0.8, median: 0.5 } },
  handwerk:         { ebitda: { min: 3.0, max: 5.0, median: 4.0 }, revenue: { min: 0.4, max: 0.9, median: 0.6 } },
  produktion:       { ebitda: { min: 3.0, max: 7.0, median: 5.0 }, revenue: { min: 0.5, max: 1.5, median: 0.9 } },
  it_beratung:      { ebitda: { min: 4.0, max: 8.0, median: 6.0 }, revenue: { min: 0.8, max: 2.0, median: 1.2 } },
  sonstige:         { ebitda: { min: 2.5, max: 5.0, median: 3.5 }, revenue: { min: 0.3, max: 0.8, median: 0.5 } },
};

// ─────────────────────────────────────────────────────────
//  Hilfsfunktionen
// ─────────────────────────────────────────────────────────

/** Unternehmensalter in Jahren */
function companyAgeYears(foundingDate) {
  if (!foundingDate) return 0;
  const ms = Date.now() - new Date(foundingDate).getTime();
  return ms / (1000 * 60 * 60 * 24 * 365.25);
}

/** 3-Jahres-Durchschnitt (fehlende Jahre werden ignoriert) */
function avgRevenue(revenues) {
  const valid = revenues.filter(v => typeof v === 'number' && v > 0);
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Umsatzwachstum (CAGR) über verfügbare Jahre */
function revenueCAGR(revenues) {
  const valid = revenues.filter(v => typeof v === 'number' && v > 0);
  if (valid.length < 2) return null;
  const first = valid[0];
  const last  = valid[valid.length - 1];
  const years = valid.length - 1;
  return Math.pow(last / first, 1 / years) - 1;
}

// ─────────────────────────────────────────────────────────
//  1. EBITDA-Normalisierung
// ─────────────────────────────────────────────────────────

/**
 * Bereinigtes EBITDA:
 * Ausgewiesenes EBITDA
 * + Über-Marktsalär Inhaber (was über marktüblicher Vergütung liegt)
 * + Einmalige Sonderaufwendungen
 * + Privat genutzte Assets (anteilig)
 * - Marktlohn Nachfolger (was ein Angestellter kosten würde)
 *
 * @param {object} financials
 * @returns {{ normalizedEbitda: number, normalizationItems: object[] }}
 */
function normalizeEbitda(financials) {
  const {
    ebitda = 0,
    ownerSalaryActual = 0,       // tatsächliches Inhabergehalt
    ownerSalaryMarket = 0,       // marktüblicher Lohn für diese Funktion
    oneOffExpenses = 0,          // einmalige Aufwendungen
    privateAssetUsage = 0,       // privat genutzte Assets €/Jahr
    successorMarketSalary = 0,   // Marktlohn für Nachfolger (oft = ownerSalaryMarket)
  } = financials;

  const overMarketSalary = Math.max(0, ownerSalaryActual - ownerSalaryMarket);
  const normalized = ebitda
    + overMarketSalary
    + oneOffExpenses
    + privateAssetUsage
    - (successorMarketSalary || ownerSalaryMarket);

  return {
    normalizedEbitda: Math.round(normalized),
    normalizationItems: [
      { label: 'Ausgewiesenes EBITDA',           value: ebitda,             sign: 0 },
      { label: 'Über-Marktsalär Inhaber',         value: overMarketSalary,   sign: +1 },
      { label: 'Einmalige Sonderaufwendungen',    value: oneOffExpenses,      sign: +1 },
      { label: 'Privat genutzte Assets',          value: privateAssetUsage,   sign: +1 },
      { label: 'Marktlohn für Nachfolger',        value: -(successorMarketSalary || ownerSalaryMarket), sign: -1 },
    ],
  };
}

// ─────────────────────────────────────────────────────────
//  2. Substanzwertmethode
// ─────────────────────────────────────────────────────────

/**
 * SW = Σ Assets(Zeitwert) - Σ Verbindlichkeiten - latente Personalverbindl.
 */
function calcSubstanzwert(data) {
  const {
    inventoryFairValue = 0,        // Lagerbestand Zeitwert
    realEstateFairValue = 0,       // Immobilien Zeitwert (nur Eigenbesitz)
    vehiclesFairValue = 0,
    machineryFairValue = 0,
    domainValue = 0,               // Geschätzter Domainwert (Formel unten)
    customerBaseValue = 0,         // Kundenstamm-Barwert
    brandValue = 0,                // Markenwert (nur eingetragene)
    contentValue = 0,              // SEO / Content
    totalLiabilities = 0,         // Verbindlichkeiten gesamt
    openInvoices = 0,              // offene Forderungen (80% ansetzbar)
    employeeLatentLiabilities = 0, // offene Urlaube, Überstunden etc.
  } = data.assets || {};

  const totalAssets =
    inventoryFairValue +
    realEstateFairValue +
    vehiclesFairValue +
    machineryFairValue +
    domainValue +
    customerBaseValue +
    brandValue +
    contentValue +
    openInvoices * 0.85;  // Forderungen mit 15% Ausfallrisiko diskontiert

  const substanzwert = totalAssets - totalLiabilities - employeeLatentLiabilities;

  return {
    method: 'substanzwert',
    value: Math.max(0, Math.round(substanzwert)),
    breakdown: {
      totalAssets: Math.round(totalAssets),
      totalLiabilities: Math.round(totalLiabilities),
      employeeLatentLiabilities: Math.round(employeeLatentLiabilities),
    },
  };
}

// ─────────────────────────────────────────────────────────
//  3. Vereinfachtes Ertragswertverfahren (§ 199–203 BewG)
// ─────────────────────────────────────────────────────────

/**
 * Kapitalisierungsfaktor gemäß § 203 BewG: 1 / Basiszins + Risikozuschlag
 * Aktuell (ab 2010 vereinfacht): 13,75
 */
const KAPITALISIERUNGSFAKTOR = 13.75;

function calcErtragswert(normalizedEbitda) {
  const value = normalizedEbitda * KAPITALISIERUNGSFAKTOR;
  return {
    method: 'ertragswert',
    value: Math.max(0, Math.round(value)),
    kapitalisierungsfaktor: KAPITALISIERUNGSFAKTOR,
    note: 'Vereinfachtes Ertragswertverfahren gem. §§ 199-203 BewG; dient als steuerliche Orientierung',
  };
}

// ─────────────────────────────────────────────────────────
//  4. EBITDA-Multiple
// ─────────────────────────────────────────────────────────

function calcEbitdaMultiple(normalizedEbitda, multipliers, adjustmentFactors) {
  const adj = calcMultiplierAdjustment(adjustmentFactors);
  const adjustedMedian = Math.max(multipliers.ebitda.min, Math.min(
    multipliers.ebitda.max,
    multipliers.ebitda.median + adj
  ));

  return {
    method: 'ebitda_multiple',
    value: Math.max(0, Math.round(normalizedEbitda * adjustedMedian)),
    multipleUsed: Math.round(adjustedMedian * 10) / 10,
    multipleRange: { min: multipliers.ebitda.min, max: multipliers.ebitda.max },
    adjustmentApplied: Math.round(adj * 10) / 10,
  };
}

// ─────────────────────────────────────────────────────────
//  5. Umsatzmultiple
// ─────────────────────────────────────────────────────────

function calcRevenuMultiple(avgRev, multipliers) {
  return {
    method: 'revenue_multiple',
    value: Math.max(0, Math.round(avgRev * multipliers.revenue.median)),
    multipleUsed: multipliers.revenue.median,
    multipleRange: { min: multipliers.revenue.min, max: multipliers.revenue.max },
  };
}

// ─────────────────────────────────────────────────────────
//  6. Vereinfachte DCF (nur bei 3J-Historie)
// ─────────────────────────────────────────────────────────

/**
 * Diskontierungssatz für KMU: 10–20% je nach Risiko-Score
 * Terminal Value: FCF5 × 3 / r (konservativ)
 */
function calcDcf(normalizedEbitda, revenues, riskScore, capex = 0, taxRate = 0.28) {
  if (!revenues || revenues.filter(v => v > 0).length < 3) {
    return null; // Nicht genug Historie
  }

  const cagr    = revenueCAGR(revenues) || 0.03; // Default 3% Wachstum
  const growth  = Math.min(Math.max(cagr, -0.10), 0.25); // Clamped
  const discR   = 0.10 + (riskScore / 100) * 0.12;        // 10–22%

  const fcfBase = normalizedEbitda * (1 - taxRate) - capex;
  if (fcfBase <= 0) return null;

  let dcfSum = 0;
  let fcf = fcfBase;
  const projections = [];

  for (let t = 1; t <= 5; t++) {
    fcf = fcf * (1 + growth);
    const pv = fcf / Math.pow(1 + discR, t);
    dcfSum += pv;
    projections.push({ year: t, fcf: Math.round(fcf), pv: Math.round(pv) });
  }

  const terminalFcf = fcf * (1 + 0.02); // 2% Perpetuity Growth
  const terminalValue = terminalFcf / (discR - 0.02);
  const terminalPV = terminalValue / Math.pow(1 + discR, 5);

  const total = dcfSum + terminalPV;

  return {
    method: 'dcf',
    value: Math.max(0, Math.round(total)),
    discountRate: Math.round(discR * 1000) / 10,
    growthRateUsed: Math.round(growth * 1000) / 10,
    projections,
    terminalValue: Math.round(terminalPV),
    note: 'Vereinfachte DCF über 5 Jahre + Terminal Value (Perpetuity Growth 2%)',
  };
}

// ─────────────────────────────────────────────────────────
//  7. Risiko-Scoring
// ─────────────────────────────────────────────────────────

/**
 * Gibt Score von 0–100 zurück (0 = kein Risiko, 100 = maximal).
 * Wird als Abschlagsbasis genutzt.
 */
function calcRiskScore(data) {
  const factors = [];
  let score = 0;

  const age = companyAgeYears(data.foundingDate);

  // ── Negative Faktoren ──
  if (age < 1)  { factors.push({ label: 'Unternehmensalter < 1 Jahr',          impact: -20, status: 'red' });   score += 20; }
  else if (age < 2) { factors.push({ label: 'Unternehmensalter 1–2 Jahre',     impact: -10, status: 'yellow' }); score += 10; }
  else if (age < 3) { factors.push({ label: 'Unternehmensalter 2–3 Jahre',     impact: -5,  status: 'yellow' }); score += 5; }
  else { factors.push({ label: 'Unternehmensalter ≥ 3 Jahre',                  impact: 0,   status: 'green' }); }

  if (!data.brandRegistered && data.brandIsKey) {
    factors.push({ label: 'Marke nicht eingetragen (prägend)',                  impact: -5,  status: 'yellow' }); score += 5;
  }

  const top3Share = data.top3CustomerShare || 0;
  if (top3Share > 0.5) {
    factors.push({ label: `Klumpenrisiko Kunden (top-3 = ${Math.round(top3Share*100)}%)`, impact: -10, status: 'red' });   score += 10;
  } else if (top3Share > 0.3) {
    factors.push({ label: 'Moderate Kundenkonzentration',                       impact: -5,  status: 'yellow' }); score += 5;
  } else {
    factors.push({ label: 'Kundenbasis breit diversifiziert',                   impact: 0,   status: 'green' });
  }

  if (data.singleSupplier) {
    factors.push({ label: 'Nur 1 Lieferant (Klumpenrisiko)',                   impact: -10, status: 'red' });    score += 10;
  } else {
    factors.push({ label: 'Mehrere Lieferanten',                               impact: 0,   status: 'green' });
  }

  const ownerDep = data.ownerDependency || 0; // 0–1
  if (ownerDep > 0.7) {
    factors.push({ label: `Hohe Inhaberabhängigkeit (${Math.round(ownerDep*100)}%)`, impact: -15, status: 'red' });   score += 15;
  } else if (ownerDep > 0.4) {
    factors.push({ label: 'Moderate Inhaberabhängigkeit',                      impact: -7,  status: 'yellow' }); score += 7;
  } else {
    factors.push({ label: 'Geringe Inhaberabhängigkeit',                       impact: 0,   status: 'green' });
  }

  if (data.openLegalDisputes) {
    factors.push({ label: 'Laufende Rechtsstreitigkeiten',                     impact: -15, status: 'red' });    score += 15;
  }

  const ebitdaMargin = data.ebitdaMargin || 0;
  if (ebitdaMargin < 0) {
    factors.push({ label: 'EBITDA negativ',                                    impact: -15, status: 'red' });    score += 15;
  } else if (ebitdaMargin < 0.05) {
    factors.push({ label: `EBITDA-Marge < 5% (${Math.round(ebitdaMargin*100)}%)`, impact: -5, status: 'yellow' }); score += 5;
  } else if (ebitdaMargin >= 0.15) {
    factors.push({ label: `EBITDA-Marge stark (${Math.round(ebitdaMargin*100)}%)`, impact: 0, status: 'green' });
  }

  const revGrowth = data.revenueGrowth; // null or number
  if (revGrowth !== null && revGrowth !== undefined) {
    if (revGrowth < -0.1) {
      factors.push({ label: `Umsatz rückläufig (${Math.round(revGrowth*100)}%/J)`, impact: -10, status: 'red' }); score += 10;
    } else if (revGrowth > 0.2) {
      factors.push({ label: `Starkes Umsatzwachstum (+${Math.round(revGrowth*100)}%/J)`, impact: 0, status: 'green' });
    }
  }

  if (!data.hasWrittenSupplierContracts) {
    factors.push({ label: 'Keine schriftlichen Lieferantenverträge',           impact: -5,  status: 'yellow' }); score += 5;
  }

  if (!data.hasAnnualFinancialStatements) {
    factors.push({ label: 'Keine vollständigen Jahresabschlüsse',              impact: -10, status: 'red' });    score += 10;
  }

  if (data.openTaxAudit) {
    factors.push({ label: 'Offene Betriebsprüfung',                            impact: -10, status: 'yellow' }); score += 10;
  }

  // ── Positive Faktoren ──
  if (data.brandRegistered) {
    factors.push({ label: 'Eingetragene Marke',                                impact: +5,  status: 'green' }); score -= 5;
  }

  if (data.longTermSupplierContract) {
    factors.push({ label: 'Langfristiger Lieferantenvertrag (> 2 J.)',         impact: +5,  status: 'green' }); score -= 5;
  }

  if (data.customerCount > 1000 && data.gdprCompliant) {
    factors.push({ label: 'Großer, DSGVO-konformer Kundenstamm',               impact: +5,  status: 'green' }); score -= 5;
  }

  if (data.multiChannel) {
    factors.push({ label: 'Mehrere Vertriebskanäle',                           impact: +5,  status: 'green' }); score -= 5;
  }

  if ((data.handoverSupportMonths || 0) >= 3) {
    factors.push({ label: 'Übergabe-Support ≥ 3 Monate',                      impact: +5,  status: 'green' }); score -= 5;
  }

  return {
    score:   Math.min(100, Math.max(0, score)),
    factors: factors,
  };
}

// ─────────────────────────────────────────────────────────
//  8. Multiplikatoren-Anpassung (Qualitätsfaktoren)
// ─────────────────────────────────────────────────────────

function calcMultiplierAdjustment(factors) {
  let adj = 0;
  const { revenueGrowth, ebitdaMargin, multiChannel, brandRegistered, ownerDependency, longTermSupplierContract } = factors || {};

  if (typeof revenueGrowth === 'number') {
    if (revenueGrowth > 0.20) adj += 0.5;
    else if (revenueGrowth > 0.10) adj += 0.3;
    else if (revenueGrowth < -0.10) adj -= 0.5;
  }
  if (typeof ebitdaMargin === 'number') {
    if (ebitdaMargin >= 0.20) adj += 0.5;
    else if (ebitdaMargin >= 0.10) adj += 0.2;
    else if (ebitdaMargin < 0.05) adj -= 0.3;
  }
  if (multiChannel)              adj += 0.3;
  if (brandRegistered)           adj += 0.3;
  if (longTermSupplierContract)  adj += 0.2;
  if ((ownerDependency || 0) > 0.7) adj -= 0.5;

  return adj;
}

// ─────────────────────────────────────────────────────────
//  9. Methoden-Auswahl-Logik
// ─────────────────────────────────────────────────────────

function selectMethods(data, normalizedEbitda) {
  const age = companyAgeYears(data.foundingDate);
  const hasHistory = data.revenues && data.revenues.filter(v => v > 0).length >= 3;

  const methods = ['substanzwert'];

  if (age >= 2 && normalizedEbitda > 0) {
    methods.push('ertragswert');
    methods.push('ebitda_multiple');
  }

  methods.push('revenue_multiple'); // Immer als Quercheck

  if (age >= 3 && normalizedEbitda > 0 && hasHistory) {
    methods.push('dcf');
  }

  return methods;
}

// ─────────────────────────────────────────────────────────
//  10. Gewichtung nach Unternehmenstyp
// ─────────────────────────────────────────────────────────

function getWeights(legalForm, normalizedEbitda, age, hasDcf) {
  if (normalizedEbitda <= 0 || age < 2) {
    return { substanzwert: 0.70, revenue_multiple: 0.30, ertragswert: 0, ebitda_multiple: 0, dcf: 0 };
  }
  if (age < 3 || !hasDcf) {
    return { substanzwert: 0.40, ertragswert: 0.25, ebitda_multiple: 0.25, revenue_multiple: 0.10, dcf: 0 };
  }
  // GbR: substanzwert higher weight
  if (['GbR', 'KG', 'OHG'].includes(legalForm)) {
    return { substanzwert: 0.35, ertragswert: 0.25, ebitda_multiple: 0.25, revenue_multiple: 0.10, dcf: 0.05 };
  }
  // Kapitalgesellschaft
  return { substanzwert: 0.20, ertragswert: 0.30, ebitda_multiple: 0.30, revenue_multiple: 0.05, dcf: 0.15 };
}

// ─────────────────────────────────────────────────────────
//  11. Steuerliche Schätzung Verkäufer (§ 16 + § 34 EStG)
// ─────────────────────────────────────────────────────────

/**
 * Grobe Schätzung des steuerlichen Veräußerungsgewinns.
 * Gilt nur für natürliche Personen (GbR-Gesellschafter, Einzelkaufmann usw.).
 * Für Kapitalgesellschaften: andere Logik (Halbeinkünfteverfahren etc.).
 */
function calcTaxEstimate(params) {
  const {
    purchasePrice = 0,
    bookValueAssets = 0,           // Buchwert Betriebsvermögen
    transactionCosts = null,       // Notar, RA, StB
    sellerAge55Plus = false,
    permanentlyDisabled = false,
    section34AlreadyUsed = false,  // § 34 Abs. 3 EStG einmalig
    estimatedTaxRate = 0.42,       // individueller ESt-Satz gesamt
    legalForm = 'GbR',
  } = params;

  // Nur für Personenunternehmen relevant
  const isPersonenunternehmen = ['GbR', 'KG', 'OHG', 'eK', 'Einzelunternehmen'].includes(legalForm);

  const estimatedTransactionCosts = transactionCosts ?? purchasePrice * 0.02; // 2% Schätzung
  const veräußerungsgewinn = Math.max(0, purchasePrice - bookValueAssets - estimatedTransactionCosts);

  // Freibetrag § 16 Abs. 4 EStG (ab 55 oder dauerhaft BU, einmalig)
  const freibetragEligible = isPersonenunternehmen && (sellerAge55Plus || permanentlyDisabled);
  let freibetrag = 0;
  if (freibetragEligible) {
    const maxFreibetrag = 45000;
    const phaseOutStart = 136000;
    freibetrag = Math.max(0, maxFreibetrag - Math.max(0, veräußerungsgewinn - phaseOutStart));
  }

  const steuerpflichtigerVG = Math.max(0, veräußerungsgewinn - freibetrag);

  // Tarifbegünstigung § 34 Abs. 3 EStG (halber Durchschnittssteuersatz)
  let estBelastung = 0;
  if (isPersonenunternehmen && freibetragEligible && !section34AlreadyUsed && steuerpflichtigerVG > 0) {
    estBelastung = steuerpflichtigerVG * (estimatedTaxRate / 2);
  } else if (steuerpflichtigerVG > 0) {
    // Normaler Steuersatz (vereinfacht: kein Kirchensteuer/Soli)
    estBelastung = steuerpflichtigerVG * estimatedTaxRate;
  }

  return {
    veräußerungsgewinn:     Math.round(veräußerungsgewinn),
    freibetrag:             Math.round(freibetrag),
    freibetragEligible,
    steuerpflichtigerVG:    Math.round(steuerpflichtigerVG),
    geschätzte_eSt:         Math.round(estBelastung),
    nettoerlös:             Math.round(purchasePrice - estimatedTransactionCosts - estBelastung),
    tarifbegünstigungGenutzt: freibetragEligible && !section34AlreadyUsed,
    disclaimer: 'Diese Berechnung ist eine vereinfachte Schätzung ohne Gewähr. Sie ersetzt keine Beratung durch einen Steuerberater. Kirchensteuer, Solidaritätszuschlag und individuelle Steuersituation werden nicht berücksichtigt.',
    isPersonenunternehmen,
  };
}

// ─────────────────────────────────────────────────────────
//  12. Hauptfunktion: Vollständige Bewertung
// ─────────────────────────────────────────────────────────

async function calculate(inputData) {
  const {
    financials = {},
    assets = {},
    legalForm = 'GbR',
    industryKey = 'sonstige',
    foundingDate,
    taxParams = {},
  } = inputData;

  // Branchenmultiplikatoren aus DB oder Fallback
  let multipliers = DEFAULT_MULTIPLIERS[industryKey] || DEFAULT_MULTIPLIERS['sonstige'];
  try {
    const { rows } = await db.query(
      'SELECT * FROM industry_multipliers WHERE industry_key = $1 AND is_active = TRUE',
      [industryKey]
    );
    if (rows.length) {
      const r = rows[0];
      multipliers = {
        ebitda:   { min: parseFloat(r.ebitda_min), max: parseFloat(r.ebitda_max),   median: parseFloat(r.ebitda_median) },
        revenue:  { min: parseFloat(r.revenue_min), max: parseFloat(r.revenue_max), median: parseFloat(r.revenue_median) },
      };
    }
  } catch { /* use fallback */ }

  // Revenues array [year-2, year-1, current]
  const revenues = [
    financials.revenueYear1 || 0,
    financials.revenueYear2 || 0,
    financials.revenueYear3 || 0,
  ];
  const avgRev = avgRevenue(revenues);
  const revGrowth = revenueCAGR(revenues);
  const ebitdaMargin = avgRev > 0 ? (financials.ebitda || 0) / avgRev : 0;
  const age = companyAgeYears(foundingDate);

  // Normalisierung
  const { normalizedEbitda, normalizationItems } = normalizeEbitda(financials);

  // Risiko-Scoring
  const riskInput = {
    ...inputData,
    foundingDate,
    ebitdaMargin,
    revenueGrowth: revGrowth,
  };
  const risk = calcRiskScore(riskInput);
  const riskDiscountFactor = 1 - (risk.score / 100) * 0.40; // Max 40% Risikoabschlag

  // Einzelne Methoden
  const substanzwert    = calcSubstanzwert({ assets: { ...assets, totalLiabilities: financials.totalLiabilities, openInvoices: financials.openInvoices, employeeLatentLiabilities: financials.employeeLatentLiabilities } });
  const ertragswert     = normalizedEbitda > 0 ? calcErtragswert(normalizedEbitda) : null;
  const ebitdaMultiple  = normalizedEbitda > 0 ? calcEbitdaMultiple(normalizedEbitda, multipliers, { revenueGrowth: revGrowth, ebitdaMargin, multiChannel: inputData.multiChannel, brandRegistered: inputData.brandRegistered, ownerDependency: inputData.ownerDependency, longTermSupplierContract: inputData.longTermSupplierContract }) : null;
  const revenueMultiple = calcRevenuMultiple(avgRev, multipliers);
  const dcf             = calcDcf(normalizedEbitda, revenues, risk.score, financials.capex || 0);

  const hasDcf = !!dcf;
  const weights = getWeights(legalForm, normalizedEbitda, age, hasDcf);

  // Gewichteter Mittelwert
  const methodResults = {
    substanzwert:     substanzwert.value,
    ertragswert:      ertragswert?.value || 0,
    ebitda_multiple:  ebitdaMultiple?.value || 0,
    revenue_multiple: revenueMultiple.value,
    dcf:              dcf?.value || 0,
  };

  let weightedSum = 0;
  let totalWeight = 0;
  const usedMethods = selectMethods({ foundingDate, revenues }, normalizedEbitda);

  for (const method of usedMethods) {
    const w = weights[method] || 0;
    const v = methodResults[method] || 0;
    if (v > 0 && w > 0) {
      weightedSum += v * w;
      totalWeight += w;
    }
  }

  const weightedMean = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : substanzwert.value;
  const recommendedValue = Math.round(weightedMean * riskDiscountFactor);

  // KP-Korridor: ±15% um empfohlenen Wert (je nach Verhandlung)
  const corridor = {
    low:  Math.round(recommendedValue * 0.85),
    mid:  recommendedValue,
    high: Math.round(recommendedValue * 1.15),
  };

  // Deal-Struktur-Empfehlung
  const dealRecommendation = recommendDealStructure(legalForm, inputData);

  // § 613a Warnung
  const employees613a = (inputData.employeeCount || 0) > 0;

  // Steuer-Schätzung
  const taxEstimate = calcTaxEstimate({
    purchasePrice: recommendedValue,
    bookValueAssets: financials.bookValueAssets || 0,
    ...taxParams,
    legalForm,
  });

  return {
    summary: {
      recommendedValue,
      corridor,
      riskScore: risk.score,
      riskDiscountFactor: Math.round((1 - riskDiscountFactor) * 100),
      normalizedEbitda,
      avgRevenue: Math.round(avgRev),
      companyAgeYears: Math.round(age * 10) / 10,
    },
    methods: {
      substanzwert,
      ertragswert,
      ebitda_multiple: ebitdaMultiple,
      revenue_multiple: revenueMultiple,
      dcf,
    },
    weights,
    normalizationItems,
    risk,
    dealRecommendation,
    taxEstimate,
    warnings: buildWarnings(inputData, employees613a, risk),
    multipliers,
  };
}

// ─────────────────────────────────────────────────────────
//  13. Deal-Struktur-Empfehlung
// ─────────────────────────────────────────────────────────

function recommendDealStructure(legalForm, data) {
  const forceAssetDeal = ['GbR', 'KG', 'OHG', 'eK', 'Einzelunternehmen'].includes(legalForm);

  if (forceAssetDeal) {
    return {
      recommended: 'asset_deal',
      reason: `Bei ${legalForm} ist nur der Asset Deal möglich. Es gibt keine Anteile, die übertragen werden könnten. Jedes Wirtschaftsgut wird einzeln übertragen.`,
      keyPoints: [
        'Käufer kann Anschaffungskosten abschreiben (steuerlicher Vorteil)',
        'Neues Kundenkonto bei Zahlungsanbietern (Stripe, PayPal etc.) notwendig',
        '§ 613a BGB: Alle Mitarbeiter gehen automatisch über',
        '§ 25 HGB: Firmennamen-Übernahme möglich bei Fortsetzung',
        'Lieferantenverträge brauchen Zustimmung der Gegenseite (§ 414 BGB)',
      ],
      sharesDealPossible: false,
    };
  }

  if (['GmbH', 'UG'].includes(legalForm)) {
    return {
      recommended: data.preferAssetDeal ? 'asset_deal' : 'share_deal',
      reason: 'Beide Strukturen möglich. Share Deal ist bei sauberer Due Diligence meist einfacher; Asset Deal bietet Käufer steuerliche Abschreibungsvorteile.',
      keyPoints: [
        'Share Deal: Gesellschaftsanteile werden übertragen (GmbHG § 15, notariell)',
        'Asset Deal: Einzelne Wirtschaftsgüter werden übertragen',
        'Steuerlich: Asset Deal oft nachteilig für Verkäufer (normaler Steuersatz)',
        'Share Deal: GmbH-Verträge bleiben bestehen (keine Zustimmung Dritter)',
      ],
      sharesDealPossible: true,
    };
  }

  return {
    recommended: 'asset_deal',
    reason: 'Standard-Empfehlung für diese Rechtsform.',
    keyPoints: [],
    sharesDealPossible: false,
  };
}

// ─────────────────────────────────────────────────────────
//  14. Warnungen
// ─────────────────────────────────────────────────────────

function buildWarnings(data, employees613a, risk) {
  const warnings = [];

  if (employees613a) {
    warnings.push({
      code: 'par_613a',
      severity: 'critical',
      title: '§ 613a BGB — Automatischer Mitarbeiterübergang',
      message: 'Bei diesem Asset Deal gehen alle Arbeitnehmer automatisch auf den Käufer über. Latente Personalverbindlichkeiten (Urlaub, Überstunden, betriebliche Altersvorsorge) müssen in der Due Diligence erfasst werden.',
      action: 'HR-Due-Diligence durchführen; Personalkosten in Kaufpreiskalkulation einbeziehen.',
    });
  }

  if (!data.dsgvoCompliant && (data.customerCount || 0) > 0) {
    warnings.push({
      code: 'dsgvo',
      severity: 'high',
      title: 'DSGVO — Kundendaten-Übertragung',
      message: 'Kundendaten dürfen nur bei Vorliegen einer Rechtsgrundlage (Art. 6 DSGVO) übertragen werden. Nicht-konformer Kundenstamm ist im Zweifel wertlos.',
      action: 'Datenschutzprüfung durch RA vor Vertragsabschluss. Ggf. erneute Einwilligung der Kunden.',
    });
  }

  if (risk.score >= 50) {
    warnings.push({
      code: 'high_risk',
      severity: 'high',
      title: 'Hohes Gesamtrisiko',
      message: `Risiko-Score ${risk.score}/100. Eine umfangreiche Due Diligence und vorsichtige Kaufpreisgestaltung sind dringend empfohlen.`,
      action: 'Steuerberater und Anwalt vor Vertragsabschluss einschalten.',
    });
  }

  if (!data.hasWrittenSupplierContracts) {
    warnings.push({
      code: 'supplier_contracts',
      severity: 'medium',
      title: 'Mündliche Lieferantenverträge',
      message: 'Mündliche Lieferantenvereinbarungen sind nur schwer übertragbar und bieten keine Sicherheit für den Käufer.',
      action: 'Wichtigste Lieferantenbeziehungen vor Deal schriftlich fixieren.',
    });
  }

  return warnings;
}

module.exports = { calculate, normalizeEbitda, calcRiskScore, calcTaxEstimate, companyAgeYears };
