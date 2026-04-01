/**
 * Contract Generator — Test Run
 * Reads the YAML template, evaluates conditions, replaces placeholders,
 * and outputs a complete contract as plain text.
 */
const jsYaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// TEST-DATEN: Online-Shop "BudXXL" — GbR (Verkäufer) → Privatperson (Käufer)
// ═══════════════════════════════════════════════════════════════════════════════
const testData = {
    // ── Conditions (Toggles) ────────────────────────
    seller_type: 'GbR',
    buyer_type: 'Privatperson',
    HAT_MITARBEITER: false,
    HAT_IMMOBILIEN: false,
    HAT_MIETVERTRAG: false,
    HAT_VORRAETE: true,
    HAT_FORDERUNGEN: false,
    HAT_VERBINDLICHKEITEN: false,
    HAT_EARNOUT: false,
    HAT_RATENZAHLUNG: true,
    HAT_TREUHANDKONTO: false,
    HAT_IP: false,
    HAT_DOMAINS: true,
    HAT_LIZENZEN: true,
    HAT_KUNDENVERTRAEGE: false,
    HAT_LIEFERANTENVERTRAEGE: true,
    HAT_FAHRZEUGE: false,
    HAT_GENEHMIGUNGEN: false,
    HAT_UMWELTRISIKEN: false,
    HAT_RECHTSSTREITIGKEITEN: false,
    HAT_BERATERVERTRAG: false,
    HAT_BETRIEBSRAT: false,
    SCHIEDSGERICHT: false,

    // ── Verkäufer (GbR) ────────────────────────────
    VERKAEUFER_NAME: 'BudXXL GbR',
    VERKAEUFER_RECHTSFORM: 'Gesellschaft bürgerlichen Rechts (GbR)',
    VERKAEUFER_ADRESSE: 'Musterstraße 12, 50667 Köln',
    VERKAEUFER_STEUER_ID: '215/5783/1024',
    VERKAEUFER_GESELLSCHAFTER: `a) Thomas Müller, geb. 04.09.1975, wohnhaft Musterstraße 12, 50667 Köln (Anteil: 60 %),
      b) Sandra Müller, geb. 17.02.1980, wohnhaft Musterstraße 12, 50667 Köln (Anteil: 40 %)`,
    VERKAEUFER_GESCHAEFTSFUEHRER: 'Thomas Müller und Sandra Müller, jeweils einzelvertretungsberechtigt',

    // ── Käufer (Privatperson) ──────────────────────
    KAEUFER_NAME: 'Herr Philipp Weber',
    KAEUFER_RECHTSFORM: 'Privatperson',
    KAEUFER_GEBURTSDATUM: '22.07.1990',
    KAEUFER_ADRESSE: 'Hauptstraße 88, 40213 Düsseldorf',

    // ── Unternehmen ─────────────────────────────────
    UNTERNEHMENSNAME: 'BudXXL',
    UNTERNEHMENSGEGENSTAND: `Online-Handel mit Heimtierbedarf, insbesondere Hundefutter, Katzenfutter, Zubehör und Pflegeprodukte über den Webshop budxxl.com`,
    UNTERNEHMENSSITZ: 'Köln',

    // ── Kaufpreis ───────────────────────────────────
    KAUFPREIS_GESAMT: '85.000,00',
    KAUFPREIS_GESAMT_WORT: 'fünfundachtzigtausend',
    KAUFPREIS_SACHANLAGEN: '2.000,00',
    KAUFPREIS_VORRAETE: '18.000,00',
    KAUFPREIS_FORDERUNGEN: '0,00',
    KAUFPREIS_IP: '5.000,00',
    KAUFPREIS_GOODWILL: '45.000,00',
    KAUFPREIS_WETTBEWERBSVERBOT: '10.000,00',
    KAUFPREIS_SONSTIGES: '5.000,00',

    // ── Konditionale Kaufpreisfelder ────────────────
    VORRAETE_UEBERALTERUNG_MONATE: '12',
    VORRAETE_ABSCHLAG_PROZENT: '50',

    // ── Ratenzahlung ────────────────────────────────
    RATE_1_BETRAG: '25.000,00',
    RATE_1_PROZENT: '29,4',
    RATEN_ANZAHL: '12',
    RATE_FOLGE_BETRAG: '5.000,00',
    RATEN_FAELLIGKEIT_TAG: '1.',
    RATE_2_DATUM: '01.08.2026',
    RATE_LETZTE_BETRAG: '5.000,00',
    RATE_LETZTE_DATUM: '01.07.2027',
    RATEN_ZINSSATZ: '4,5',
    RATEN_VERZUG_TAGE: '14',

    // ── Termine ─────────────────────────────────────
    SIGNING_DATUM: '15.06.2026',
    SIGNING_ORT: 'Düsseldorf',
    STICHTAG: '30.06.2026',
    CLOSING_DATUM: '01.07.2026',

    // ── USt ─────────────────────────────────────────
    UST_SATZ: '19',

    // ── Bankverbindung (Verkäufer = GbR) ─────────────
    VERKAEUFER_IBAN: 'DE89 3704 0044 0532 0130 00',
    VERKAEUFER_BIC: 'COBADEFFXXX',
    VERKAEUFER_BANK: 'Commerzbank Köln',

    // ── Stichtag-Klauseln ──────────────────────────
    WESENTLICHKEITSSCHWELLE: '2.500',
    WESENTLICHKEITSSCHWELLE_GESAMT: '5.000',
    MAX_VERTRAGS_LAUFZEIT: '12',

    // ── Garantien ───────────────────────────────────
    BILANZ_JAHRE: '2023, 2024, 2025',
    LETZTER_BILANZSTICHTAG: '31.12.2025',
    ABMAHNUNG_ZEITRAUM_JAHRE: '3',

    // ── Haftung/Garantiefolgen ──────────────────────
    HAFTUNGSCAP_BETRAG: '85.000,00',
    HAFTUNGSCAP_PROZENT: '100',
    VERJAEHRUNG_ALLGEMEIN_MONATE: '18',
    VERJAEHRUNG_STEUER_JAHRE: '5',
    VERJAEHRUNG_EIGENTUM_JAHRE: '10',

    // ── Wettbewerbsverbot ──────────────────────────
    WETTBEWERBSVERBOT_DAUER_JAHRE: '2',
    WETTBEWERBSVERBOT_GEBIET: 'die Bundesrepublik Deutschland',
    WETTBEWERBSVERBOT_BRANCHE: 'den Online-Handel mit Heimtierbedarf und Tiernahrung',
    VERTRAGSSTRAFE_BETRAG: '15.000,00',

    // ── Geheimhaltung ──────────────────────────────
    GEHEIMHALTUNG_DAUER_JAHRE: '3',
    GEHEIMHALTUNG_VERTRAGSSTRAFE: '10.000,00',

    // ── Übergangsphase ─────────────────────────────
    EINARBEITUNG_DAUER_MONATE: '3',
    EINARBEITUNG_STUNDEN: '10',
    UEBERGANG_VERGUETUNG_OPTION: 'ist mit dem Kaufpreis abgegolten.',

    // ── Online-Shop Spezifisch ─────────────────────
    SOCIAL_MEDIA_PLATTFORMEN: 'Instagram (@budxxl), Facebook (BudXXL), TikTok (@budxxl_official)',
    SHOP_SYSTEM_NAME: 'Shopify',
    PAYMENT_PROVIDER: 'Stripe, PayPal, Klarna',

    // ── Gerichtsstand ──────────────────────────────
    GERICHTSSTAND: 'Düsseldorf',
    LONG_STOP_DATE: '31.08.2026',

    // ── Einbehalt (wenn kein Treuhand) ─────────────
    EINBEHALT_BETRAG: '8.500,00',
    EINBEHALT_PROZENT: '10',
    EINBEHALT_MONATE: '12',

    // ── Sonstige Ausnahmen ─────────────────────────
    WEITERE_AUSNAHMEN: 'privates Büromobiliar der Gesellschafter (soweit nicht in Anlage 2.2 aufgeführt),',

    // ─ Dummy für nicht genutzte ────────────────────
    IHK_ORT: 'Düsseldorf',
    FUSIONSKONTROLLE_ERGEBNIS: 'Die Schwellenwerte nach § 35 GWB werden nicht erreicht; eine Anmeldung ist nicht erforderlich.',
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATOR
// ═══════════════════════════════════════════════════════════════════════════════
function evalCondition(condition, data) {
    if (!condition || condition === 'null') return true;

    let expr = condition
        .replace(/\bAND\b/gi, '&&')
        .replace(/\bOR\b/gi, '||')
        .replace(/\bNOT\b/gi, '!')
        .replace(/\bIN\b/gi, 'in_arr')
        .replace(/\btrue\b/gi, 'true')
        .replace(/\bfalse\b/gi, 'false');

    // Replace variable references with their values
    for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'boolean') {
            expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), val.toString());
        } else if (typeof val === 'string') {
            expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), `"${val}"`);
        }
    }

    // Handle "seller_type == 'X'" and "buyer_type == 'X'" style
    expr = expr.replace(/(\w+)\s*==\s*'([^']+)'/g, (_, v, val) => {
        const actual = data[v];
        return actual === val ? 'true' : 'false';
    });

    // Handle IN arrays
    expr = expr.replace(/(\w+)\s+in_arr\s+\[([^\]]+)\]/g, (_, v, arr) => {
        const actual = data[v];
        const items = arr.split(',').map(s => s.trim().replace(/'/g, ''));
        return items.includes(actual) ? 'true' : 'false';
    });

    // Handle "NOT IN" pattern (already converted to "! in_arr")
    expr = expr.replace(/!(\w+)\s+in_arr\s+\[([^\]]+)\]/g, (_, v, arr) => {
        const actual = data[v];
        const items = arr.split(',').map(s => s.trim().replace(/'/g, ''));
        return !items.includes(actual) ? 'true' : 'false';
    });

    try {
        return Function(`"use strict"; return (${expr});`)();
    } catch {
        // If we can't evaluate, include by default (safe side)
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLACEHOLDER REPLACER
// ═══════════════════════════════════════════════════════════════════════════════
function replacePlaceholders(text, data) {
    if (!text) return '';
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// VARIANT HANDLER — replaces seller/buyer blocks in rubrum & signatures
// ═══════════════════════════════════════════════════════════════════════════════
function applyVariants(rawText, variants, data) {
    if (!variants || !variants.length) return rawText;
    let text = rawText;
    for (const v of variants) {
        if (!evalCondition(v.condition, data)) continue;
        if (v.replaces === 'VERKAEUFER_NAME block') {
            // Rubrum: replace seller block (from {{VERKAEUFER_NAME}} to before "— nachfolgend „Verkäufer")
            const rubrumSeller = /\{\{VERKAEUFER_NAME\}\},\n.*?(?=\n\s*— nachfolgend „Verkäufer")/s;
            // Unterschriften: replace seller signature block
            const sigSeller = /_+\n\s*\{\{VERKAEUFER_NAME\}\}\n\s*\(Verkäufer\)/;
            if (rubrumSeller.test(text)) {
                text = text.replace(rubrumSeller, v.text.trimEnd());
            } else if (sigSeller.test(text)) {
                text = text.replace(sigSeller, v.text.trimEnd());
            }
        } else if (v.replaces === 'KAEUFER_NAME block') {
            // Rubrum: replace buyer block (from {{KAEUFER_NAME}} to before "— nachfolgend „Käufer")
            const rubrumBuyer = /\{\{KAEUFER_NAME\}\},\n.*?(?=\n\s*— nachfolgend „Käufer")/s;
            // Unterschriften: replace buyer signature block
            const sigBuyer = /_+\n\s*\{\{KAEUFER_NAME\}\}\n.*?\(Käufer\)/s;
            if (rubrumBuyer.test(text)) {
                text = text.replace(rubrumBuyer, v.text.trimEnd());
            } else if (sigBuyer.test(text)) {
                text = text.replace(sigBuyer, v.text.trimEnd());
            }
        }
    }
    return text;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════
function generateContract(templatePath, data) {
    const raw = fs.readFileSync(templatePath, 'utf8');
    const tpl = jsYaml.load(raw);

    const lines = [];

    // Sort sections by order
    const sections = tpl.sections
        .filter(s => evalCondition(s.condition, data))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const section of sections) {
        // Section main text — apply variants first, then placeholders
        if (section.text) {
            let sectionText = section.text;
            if (section.variants) {
                sectionText = applyVariants(sectionText, section.variants, data);
            }
            lines.push(replacePlaceholders(sectionText, data));
        }

        // Section clauses
        if (section.clauses) {
            for (const clause of section.clauses) {
                if (!evalCondition(clause.condition, data)) continue;
                if (clause.text) {
                    let clauseText = replacePlaceholders(clause.text, data);
                    lines.push(clauseText);
                }
            }
        }

        lines.push(''); // blank line between sections
    }

    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════════════
const templatePath = path.join(__dirname, '..', '..', 'contracts', 'templates', 'asset_kaufvertrag.yaml');
const contract = generateContract(templatePath, testData);

// Write output
const outputPath = path.join(__dirname, '..', '..', 'contracts', 'output', 'test_kaufvertrag_budxxl.txt');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, contract, 'utf8');

console.log(`✓ Vertrag generiert: ${outputPath}`);
console.log(`✓ Länge: ${contract.length} Zeichen, ${contract.split('\n').length} Zeilen`);
console.log('\n' + '═'.repeat(80));
console.log(contract);
