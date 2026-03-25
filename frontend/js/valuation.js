/**
 * valuation.js — Client-side valuation engine (preview / offline mode)
 * Mirrors the backend valuation service logic for instant UI feedback.
 * The authoritative result always comes from the backend.
 */

const ValuationEngine = (() => {

  /* ── Multiplier defaults (fallback when backend unavailable) ───── */
  const MULTIPLIER_DEFAULTS = {
    ecommerce:      { ebitda: { low: 2.0, median: 3.5, high: 5.0 }, umsatz: { low: 0.4, median: 0.8, high: 1.2 } },
    agrar_handel:   { ebitda: { low: 2.0, median: 3.0, high: 4.0 }, umsatz: { low: 0.2, median: 0.35, high: 0.5 } },
    saas:           { ebitda: { low: 4.0, median: 7.0, high: 12.0 }, umsatz: { low: 2.0, median: 4.0, high: 8.0 } },
    dienstleistung: { ebitda: { low: 2.5, median: 4.0, high: 6.0 }, umsatz: { low: 0.5, median: 1.0, high: 1.5 } },
    handel:         { ebitda: { low: 1.5, median: 2.5, high: 4.0 }, umsatz: { low: 0.15, median: 0.3, high: 0.5 } },
    gastronomie:    { ebitda: { low: 1.5, median: 2.5, high: 3.5 }, umsatz: { low: 0.2, median: 0.4, high: 0.6 } },
    handwerk:       { ebitda: { low: 2.0, median: 3.0, high: 4.5 }, umsatz: { low: 0.3, median: 0.5, high: 0.8 } },
    produktion:     { ebitda: { low: 3.0, median: 4.5, high: 6.0 }, umsatz: { low: 0.4, median: 0.7, high: 1.0 } },
    gesundheit:     { ebitda: { low: 3.0, median: 5.0, high: 7.0 }, umsatz: { low: 0.5, median: 1.0, high: 1.8 } },
    sonstige:       { ebitda: { low: 2.0, median: 3.0, high: 5.0 }, umsatz: { low: 0.3, median: 0.6, high: 1.0 } },
  };

  /* ── § 199 BewG Kapitalisierungsfaktor ─────────────────────────── */
  const KAPITALISIERUNGSFAKTOR = 13.75;

  /* ── EBITDA Normalisierung ──────────────────────────────────────── */
  function normalizeEBITDA(fin) {
    const {
      ebitda = 0,
      inhabergehalt = 0,
      marktgehaltNachfolger = 65000,
      einmaligkosten = 0,
      privatnutzung = 0,
    } = fin;

    const excessOwnerSalary = Math.max(0, inhabergehalt - marktgehaltNachfolger);
    const normalized = ebitda + excessOwnerSalary + einmaligkosten + privatnutzung - marktgehaltNachfolger;

    return {
      base: ebitda,
      plusExcessOwnerSalary: excessOwnerSalary,
      plusEinmaligkosten: einmaligkosten,
      plusPrivatnutzung: privatnutzung,
      minusMarktgehalt: marktgehaltNachfolger,
      normalized,
    };
  }

  /* ── Substanzwert ───────────────────────────────────────────────── */
  function calcSubstanzwert(assets) {
    const {
      inventarMarket = 0,
      inventarMhd = 0,         // % ablaufend < 12 Monate
      maschinen = 0,
      immobilien = 0,
      domainWert = 0,
      shopWert = 0,
      kassenbestand = 0,
      verbindlichkeiten = 0,
      // Social media
      instagram = 0,
      facebook = 0,
      youtube = 0,
      tiktok = 0,
      newsletterAbonnenten = 0,
    } = assets;

    // Inventar: Diskont für MHD-Risiko
    const mhdFaktor = 1 - (inventarMhd / 100) * 0.8; // abgelaufene Ware → 80% WertMinderung
    const inventarAdjusted = inventarMarket * Math.max(0, mhdFaktor);

    // Social Media Bewertung (konservativ)
    const socialValue =
      instagram * 1.2 +
      facebook * 0.4 +
      youtube * 2.0 +
      tiktok * 0.8 +
      newsletterAbonnenten * 3.0; // Newsletter sehr wertvoll

    const bruttoSubstanz =
      inventarAdjusted * 0.9 +   // Inventar: 90% Marktwert
      maschinen * 0.7 +           // Maschinen: 70% (Abwertung)
      immobilien +
      domainWert +
      shopWert * 0.6 +            // Shop-Infrastruktur: 60%
      socialValue +
      kassenbestand;

    const netto = bruttoSubstanz - verbindlichkeiten;

    return {
      bruttoSubstanz,
      inventarAdjusted,
      socialValue,
      netto,
      details: {
        inventar: inventarAdjusted * 0.9,
        maschinen: maschinen * 0.7,
        immobilien,
        dome: domainWert,
        shopWert: shopWert * 0.6,
        social: socialValue,
        kasse: kassenbestand,
        verbindlichkeiten,
      },
    };
  }

  /* ── Ertragswert (§ 199 BewG vereinfacht) ──────────────────────── */
  function calcErtragswert(normalizedEBITDA) {
    if (normalizedEBITDA <= 0) return { ertragswert: 0, faktor: KAPITALISIERUNGSFAKTOR };
    return {
      ertragswert: normalizedEBITDA * KAPITALISIERUNGSFAKTOR,
      faktor: KAPITALISIERUNGSFAKTOR,
    };
  }

  /* ── EBITDA-Multiple ────────────────────────────────────────────── */
  function calcEbitdaMultiple(normalizedEBITDA, branche, qualityScore = 0) {
    if (normalizedEBITDA <= 0) return { low: 0, mid: 0, high: 0 };
    const mults = MULTIPLIER_DEFAULTS[branche] || MULTIPLIER_DEFAULTS.sonstige;
    const adj = qualityScore / 100; // -1 to +1 range
    const adjLow = mults.ebitda.low * (1 + adj * 0.3);
    const adjMid = mults.ebitda.median * (1 + adj * 0.3);
    const adjHigh = mults.ebitda.high * (1 + adj * 0.3);
    return {
      low: normalizedEBITDA * adjLow,
      mid: normalizedEBITDA * adjMid,
      high: normalizedEBITDA * adjHigh,
      multiplierLow: adjLow,
      multiplierMid: adjMid,
      multiplierHigh: adjHigh,
    };
  }

  /* ── Umsatz-Multiple ────────────────────────────────────────────── */
  function calcUmsatzMultiple(umsatz, branche) {
    if (!umsatz || umsatz <= 0) return { low: 0, mid: 0, high: 0 };
    const mults = MULTIPLIER_DEFAULTS[branche] || MULTIPLIER_DEFAULTS.sonstige;
    return {
      low: umsatz * mults.umsatz.low,
      mid: umsatz * mults.umsatz.median,
      high: umsatz * mults.umsatz.high,
      multiplierLow: mults.umsatz.low,
      multiplierMid: mults.umsatz.median,
      multiplierHigh: mults.umsatz.high,
    };
  }

  /* ── Risiko-Score ───────────────────────────────────────────────── */
  function calcRisikoScore(data) {
    let score = 0;
    const factors = [];
    const positives = [];

    const {
      rechtsform,
      jahresabschluss,
      buchhaltung,
      inhaberAbhaengigkeit,
      markttrend,
      saisonalitaet,
      kundenkonzentration = 0,
      anzahlMitarbeiter = 0,
      laufendeKlagen,
      hauptlieferantAbhaengigkeit = 0,
      wiederkaeuferquote = 0,
      markeEingetragen,
      crmVorhanden,
      zahlungsanbieter = [],
      lieferantenvertraegeUebertragbar,
    } = data;

    // Positive Faktoren
    if (jahresabschluss === '3_jahre') { score += 10; positives.push({ key: 'jahresabschluss3', delta: +10 }); }
    else if (jahresabschluss === '2_jahre') { score += 5; positives.push({ key: 'jahresabschluss2', delta: +5 }); }
    if (markttrend === 'stark_wachsend') { score += 15; positives.push({ key: 'markt_stark_wachsend', delta: +15 }); }
    else if (markttrend === 'wachsend') { score += 8; positives.push({ key: 'markt_wachsend', delta: +8 }); }
    if (wiederkaeuferquote >= 40) { score += 10; positives.push({ key: 'hohe_wiederkaufsrate', delta: +10 }); }
    if (markeEingetragen === 'ja') { score += 8; positives.push({ key: 'marke_eingetragen', delta: +8 }); }
    if (crmVorhanden === 'ja') { score += 5; positives.push({ key: 'crm_vorhanden', delta: +5 }); }
    if (lieferantenvertraegeUebertragbar === 'ja') { score += 5; positives.push({ key: 'lieferanten_uebertragbar', delta: +5 }); }
    if (inhaberAbhaengigkeit === 'keine') { score += 12; positives.push({ key: 'keine_inhaberabh', delta: +12 }); }
    else if (inhaberAbhaengigkeit === 'gering') { score += 6; positives.push({ key: 'geringe_inhaberabh', delta: +6 }); }

    // Risiko Faktoren
    if (buchhaltung === 'keine') { score -= 20; factors.push({ key: 'keine_buchhaltung', delta: -20 }); }
    if (jahresabschluss === 'nein') { score -= 15; factors.push({ key: 'keine_jahresabschluss', delta: -15 }); }
    if (laufendeKlagen === 'ja') { score -= 20; factors.push({ key: 'laufende_klagen', delta: -20 }); }
    if (inhaberAbhaengigkeit === 'stark') { score -= 20; factors.push({ key: 'stark_inhaberabh', delta: -20 }); }
    else if (inhaberAbhaengigkeit === 'mittel') { score -= 8; factors.push({ key: 'mittel_inhaberabh', delta: -8 }); }
    if (markttrend === 'schrumpfend') { score -= 15; factors.push({ key: 'schrumpfender_markt', delta: -15 }); }
    if (saisonalitaet === 'extrem') { score -= 10; factors.push({ key: 'extrem_saisonal', delta: -10 }); }
    else if (saisonalitaet === 'stark') { score -= 5; factors.push({ key: 'stark_saisonal', delta: -5 }); }
    if (kundenkonzentration > 50) { score -= 15; factors.push({ key: 'kundenkonz_hoch', delta: -15 }); }
    else if (kundenkonzentration > 30) { score -= 8; factors.push({ key: 'kundenkonz_mittel', delta: -8 }); }
    if (hauptlieferantAbhaengigkeit > 70) { score -= 12; factors.push({ key: 'lieferant_abh_hoch', delta: -12 }); }
    else if (hauptlieferantAbhaengigkeit > 50) { score -= 6; factors.push({ key: 'lieferant_abh_mittel', delta: -6 }); }
    if (anzahlMitarbeiter > 0) { score -= 5; factors.push({ key: 'mitarbeiter_613a', delta: -5 }); }
    if (zahlungsanbieter.includes('shopify_payments')) { score -= 3; factors.push({ key: 'shopify_payments_nicht_uebertragbar', delta: -3 }); }

    // Clamp score to -100 / +100
    score = Math.max(-100, Math.min(100, score));

    return {
      score,
      adjustment: score / 2, // ±50% max adjustment
      risikoFaktoren: factors,
      positivFaktoren: positives,
      label: score >= 20 ? 'gut' : score >= 0 ? 'neutral' : score >= -20 ? 'erhöht' : 'hoch',
    };
  }

  /* ── Steuerberechnung §§ 16, 34 EStG (Schätzung) ───────────────── */
  function estimateTax({ verauesserungsgewinn, buchwertAnteile = 0, alter, freibetragGenutzt = false }) {
    const vg = verauesserungsgewinn - buchwertAnteile;
    if (vg <= 0) return { verauesserungsgewinn: vg, steuer: 0, note: 'Kein steuerpflichtiger Gewinn' };

    // § 16 Abs. 4 EStG Freibetrag
    let freibetrag = 0;
    if (!freibetragGenutzt && alter >= 55) {
      const maxFreibetrag = 45000;
      const abschmellbetrag = Math.max(0, vg - 136000);
      freibetrag = Math.max(0, maxFreibetrag - abschmellbetrag);
    }

    const zvE = vg - freibetrag;
    if (zvE <= 0) return { verauesserungsgewinn: vg, freibetrag, steuer: 0, note: 'Vollständig durch Freibetrag abgedeckt' };

    // § 34 Abs. 1 EStG: Fünftelregelung (vereinfacht — Durchschnittssatz angenommen 30 % Grenz-EST)
    // Vereinfachte Annahme: 30 % eff. Steuersatz auf außerordentliche Einkünfte
    const effRate = 0.30;
    const steuer = zvE * effRate;

    // § 34 Abs. 3: Ermäßigter Steuersatz einmalig ab 55 (pauschal 56 %)  
    // Hinweis: Tatsächliche Berechnung berücksichtigt den individuellen Steuersatz
    const steuerErmaessigt = alter >= 55 ? zvE * 0.28 : steuer; // Näherung

    return {
      verauesserungsgewinn: vg,
      freibetrag,
      zvE,
      steuer: steuerErmaessigt,
      steuerOhneErmaessigung: steuer,
      note: 'Schätzung — nur §§ 16, 34 EStG. Soli + KiSt nicht berücksichtigt.',
      disclaimer: true,
    };
  }

  /* ── Gewichtete Gesamtbewertung ─────────────────────────────────── */
  function calcWeightedValue(methods, weights) {
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [key, val] of Object.entries(methods)) {
      const w = weights[key] || 0;
      if (w > 0 && val > 0) {
        weightedSum += val * w;
        totalWeight += w;
      }
    }
    if (totalWeight === 0) return 0;
    return weightedSum / totalWeight;
  }

  /* ── Bewertungsgewichtung je Rechtsform + Unternehmensalter ─────── */
  function getWeightingStrategy(data) {
    const { rechtsform, jahresabschluss, normalizedEBITDA, gruendungsjahr } = data;
    const age = new Date().getFullYear() - parseInt(gruendungsjahr || 0, 10);
    const hasEBITDA = normalizedEBITDA > 0;
    const has3Y = jahresabschluss === '3_jahre';
    const has2Y = jahresabschluss === '2_jahre' || has3Y;
    const isKapital = ['gmbh', 'ag', 'ug', 'gmbh_co_kg'].includes(rechtsform);

    if (!hasEBITDA || age < 2) {
      // Junges Unternehmen / negatives EBITDA → Substanz dominiert
      return { substanzwert: 0.70, umsatzMultiple: 0.30 };
    } else if (isKapital && has3Y) {
      // Kapitalgesellschaft mit 3 Jahren Historie → ausgewogen, DCF möglich
      return { ertragswert: 0.35, ebitdaMultiple: 0.35, umsatzMultiple: 0.10, substanzwert: 0.20 };
    } else if (has2Y && hasEBITDA) {
      // Personengesellschaft mit 2+ Jahren → EBITDA + Substanz
      return { substanzwert: 0.35, ertragswert: 0.30, ebitdaMultiple: 0.35 };
    } else {
      // Fallback: Substanz + Umsatz
      return { substanzwert: 0.50, umsatzMultiple: 0.50 };
    }
  }

  /* ── Hauptfunktion: Vollständige Bewertung ──────────────────────── */
  function calculate(data) {
    const {
      // Schritt 1
      rechtsform, branche, gruendungsjahr,
      // Schritt 2 — Finanzhistorie (Array, neuestes zuerst)
      finanzhistorie = [],
      marktgehaltNachfolger = 65000,
      einmaligkosten = 0,
      privatnutzung = 0,
      verbindlichkeiten = 0,
      kassenbestand = 0,
      jahresabschluss,
      // Schritt 3
      inventarMarket = 0,
      inventarMhd = 0,
      maschinen = 0,
      immobilien = 0,
      domainWert = 0,
      shopWert = 0,
      instagram = 0, facebook = 0, youtube = 0, tiktok = 0, newsletterAbonnenten = 0,
      // Schritt 7
      alter: verkaeufersAlter = 50,
      buchwertAnteile = 0,
      freibetragGenutzt = false,
    } = data;

    // Durchschnitt der verfügbaren Finanzjahre
    const jahre = finanzhistorie.filter(j => j.umsatz > 0);
    const avgUmsatz = jahre.length ? jahre.reduce((s, j) => s + (j.umsatz || 0), 0) / jahre.length : 0;
    const avgEBITDA = jahre.length ? jahre.reduce((s, j) => s + (j.ebitda || 0), 0) / jahre.length : 0;
    const avgInhabersgehalt = jahre.length ? jahre.reduce((s, j) => s + (j.inhabergehalt || 0), 0) / jahre.length : 0;

    // EBITDA Normalisierung
    const normResult = normalizeEBITDA({
      ebitda: avgEBITDA,
      inhabergehalt: avgInhabersgehalt,
      marktgehaltNachfolger,
      einmaligkosten,
      privatnutzung,
    });

    // Risiko-Score
    const risiko = calcRisikoScore({ ...data, jahresabschluss });

    // Einzelmethoden
    const substanz = calcSubstanzwert({
      inventarMarket, inventarMhd, maschinen, immobilien,
      domainWert, shopWert, kassenbestand, verbindlichkeiten,
      instagram, facebook, youtube, tiktok, newsletterAbonnenten,
    });

    const ertragswertResult = calcErtragswert(normResult.normalized);
    const ebitdaMultipleResult = calcEbitdaMultiple(normResult.normalized, branche, risiko.score);
    const umsatzMultipleResult = calcUmsatzMultiple(avgUmsatz, branche);

    // Methoden-Map für Gewichtung (Median-Werte)
    const methods = {
      substanzwert: substanz.netto,
      ertragswert: ertragswertResult.ertragswert,
      ebitdaMultiple: ebitdaMultipleResult.mid || 0,
      umsatzMultiple: umsatzMultipleResult.mid || 0,
    };

    const weights = getWeightingStrategy({ rechtsform, jahresabschluss, normalizedEBITDA: normResult.normalized, gruendungsjahr });
    const weightedValue = calcWeightedValue(methods, weights);

    // Bandbreite: ±20 % um gewichteten Wert
    const low = Math.max(0, weightedValue * 0.8);
    const high = weightedValue * 1.2;

    // Steuerberechnung  
    const taxResult = estimateTax({
      verauesserungsgewinn: weightedValue,
      buchwertAnteile,
      alter: verkaeufersAlter,
      freibetragGenutzt: freibetragGenutzt === 'ja',
    });

    return {
      normEBITDA: normResult,
      substanzwert: substanz,
      ertragswert: ertragswertResult,
      ebitdaMultiple: ebitdaMultipleResult,
      umsatzMultiple: umsatzMultipleResult,
      methods,
      weights,
      weightedValue,
      range: { low, mid: weightedValue, high },
      risiko,
      tax: taxResult,
      avgUmsatz,
      avgEBITDA,
      avgInhabersgehalt,
    };
  }

  /* ── Warnungen generieren ───────────────────────────────────────── */
  function generateWarnings(data) {
    const warnings = [];
    const { rechtsform, anzahlMitarbeiter, inventarMhd, zahlungsanbieter = [],
      amazon = 0, ebay = 0, markeEingetragen, kundenkonzentration = 0,
      inhaberAbhaengigkeit, jahresabschluss } = data;

    if (['gbr', 'einzelunternehmen', 'kg'].includes(rechtsform)) {
      warnings.push({ key: 'gbr_nur_asset_deal', level: 'info' });
    }
    if (anzahlMitarbeiter > 0) {
      warnings.push({ key: 'par613a', level: 'danger' });
    }
    if (inventarMhd > 20) {
      warnings.push({ key: 'mhd_inventar', level: 'warning' });
    }
    if (zahlungsanbieter.length > 0) {
      warnings.push({ key: 'zahlungsanbieter', level: 'warning' });
    }
    if (amazon > 0 || ebay > 0) {
      warnings.push({ key: 'amazon_konto', level: 'warning' });
    }
    if (markeEingetragen !== 'ja') {
      warnings.push({ key: 'keine_marke', level: 'info' });
    }
    if (kundenkonzentration > 30) {
      warnings.push({ key: 'hohe_kundenkonzentration', level: 'warning' });
    }
    if (inhaberAbhaengigkeit === 'stark') {
      warnings.push({ key: 'hohe_inhaberabhaengigkeit', level: 'warning' });
    }
    if (jahresabschluss === 'nein') {
      warnings.push({ key: 'keine_jahresabschluesse', level: 'warning' });
    }
    return warnings;
  }

  return { calculate, normalizeEBITDA, calcSubstanzwert, calcErtragswert,
    calcEbitdaMultiple, calcUmsatzMultiple, calcRisikoScore, estimateTax,
    generateWarnings, MULTIPLIER_DEFAULTS };
})();

window.ValuationEngine = ValuationEngine;
