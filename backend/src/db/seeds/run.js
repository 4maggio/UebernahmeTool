'use strict';

/**
 * DB Seed: Initiale Checklisten + Branchenmultiplikatoren + Admin-User
 *
 * Usage: npm run seed
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const bcrypt = require('bcrypt');
const db     = require('../index');

async function seed() {
  console.log('Seeding database...');

  // ── Admin user ──
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH) {
    await db.query(
      `INSERT INTO admin_users (email, password_hash, role)
       VALUES ($1, $2, 'superadmin')
       ON CONFLICT (email) DO NOTHING`,
      [process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD_HASH]
    );
    console.log(`  [admin] ${process.env.ADMIN_EMAIL}`);
  }

  // ── Branchenmultiplikatoren ──
  const multipliers = [
    { key: 'ecommerce',       labelDe: 'E-Commerce (allgemein)',         labelEn: 'E-Commerce (general)',       eMin: 2.0,  eMax: 5.0,  eMed: 3.5, rMin: 0.4, rMax: 1.2, rMed: 0.7,  source: 'BVK Jahresbericht 2024; Erfahrungswerte',             notesDe: 'Stark abhängig von Nische, Marke, Wiederkaufrate' },
    { key: 'agrar_handel',    labelDe: 'Agrar- / Gartenbau-Handel',      labelEn: 'Agricultural / Garden Trade', eMin: 2.0,  eMax: 4.0,  eMed: 3.0, rMin: 0.2, rMax: 0.5, rMed: 0.35, source: 'Branchenanalyse KMU 2024; Nexxt-Change-Daten',         notesDe: 'Saisonale Umsatzschwankungen beachten; Lagerrisiko bei Nährstoffen mit MHD' },
    { key: 'saas',            labelDe: 'Software as a Service (SaaS)',   labelEn: 'Software as a Service (SaaS)', eMin: 8.0,  eMax: 20.0, eMed: 12.0, rMin: 3.0, rMax: 8.0, rMed: 5.0, source: 'SaaStr; Bundesbank Branchendaten Tech 2024',          notesDe: 'Sehr hohe Bewertungen nur bei nachgewiesenem ARR-Wachstum und Churn < 5%' },
    { key: 'dienstleistung',  labelDe: 'Dienstleistung (allgemein)',     labelEn: 'General Services',            eMin: 3.0,  eMax: 6.0,  eMed: 4.5, rMin: 0.5, rMax: 1.0, rMed: 0.7,  source: 'IHK Nachfolge-Report 2024',                          notesDe: 'Höher bei geringer Inhaberabhängigkeit und skalierbaren Prozessen' },
    { key: 'handel_offline',  labelDe: 'Stationärer Handel',            labelEn: 'Brick-and-Mortar Retail',     eMin: 2.0,  eMax: 4.0,  eMed: 3.0, rMin: 0.2, rMax: 0.5, rMed: 0.35, source: 'HDE Handelsverband 2024; IfM Bonn',                   notesDe: 'Stark von Lage und Mietvertrag abhängig' },
    { key: 'gastronomie',     labelDe: 'Gastronomie / Hotellerie',      labelEn: 'Food & Beverage / Hospitality', eMin: 2.0, eMax: 5.0, eMed: 3.5, rMin: 0.3, rMax: 0.8, rMed: 0.5,  source: 'DEHOGA-Branchenreport 2024',                         notesDe: 'Pachtvertrag und Konzession sind kritisch; hohe operative Abhängigkeit' },
    { key: 'handwerk',        labelDe: 'Handwerk',                      labelEn: 'Craft / Trades',              eMin: 3.0,  eMax: 5.0,  eMed: 4.0, rMin: 0.4, rMax: 0.9, rMed: 0.6,  source: 'ZDH Handwerksstatistik 2024; IHK Nachfolge',         notesDe: 'Meisterpflicht beachten; Kundenstamm oft stark inhabergebunden' },
    { key: 'produktion',      labelDe: 'Produktion / Fertigung',        labelEn: 'Manufacturing / Production',  eMin: 3.0,  eMax: 7.0,  eMed: 5.0, rMin: 0.5, rMax: 1.5, rMed: 0.9,  source: 'Bundesbank Branchendaten Produktion 2024',           notesDe: 'Maschinenpark-Zustand und Automatisierungsgrad prägen Wert erheblich' },
    { key: 'it_beratung',     labelDe: 'IT-Beratung / Agentur',        labelEn: 'IT Consulting / Agency',      eMin: 4.0,  eMax: 8.0,  eMed: 6.0, rMin: 0.8, rMax: 2.0, rMed: 1.2,  source: 'Bitkom M&A-Report 2024',                             notesDe: 'Wiederkehrende Einnahmen (Wartungsverträge) deutlich höher bewertet' },
    { key: 'sonstige',        labelDe: 'Sonstige Branchen',             labelEn: 'Other Industries',            eMin: 2.5,  eMax: 5.0,  eMed: 3.5, rMin: 0.3, rMax: 0.8, rMed: 0.5,  source: 'Konservative Schätzung basierend auf IfM Bonn 2024', notesDe: 'Fallback für nicht klassifizierbare Branchen' },
  ];

  for (const m of multipliers) {
    await db.query(
      `INSERT INTO industry_multipliers
         (industry_key, label_de, label_en, ebitda_min, ebitda_max, ebitda_median,
          revenue_min, revenue_max, revenue_median, notes_de, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (industry_key) DO UPDATE SET
         label_de=EXCLUDED.label_de, label_en=EXCLUDED.label_en,
         ebitda_min=EXCLUDED.ebitda_min, ebitda_max=EXCLUDED.ebitda_max,
         ebitda_median=EXCLUDED.ebitda_median,
         revenue_min=EXCLUDED.revenue_min, revenue_max=EXCLUDED.revenue_max,
         revenue_median=EXCLUDED.revenue_median,
         notes_de=EXCLUDED.notes_de, source=EXCLUDED.source,
         last_updated=CURRENT_DATE`,
      [m.key, m.labelDe, m.labelEn, m.eMin, m.eMax, m.eMed, m.rMin, m.rMax, m.rMed, m.notesDe, m.source]
    );
    console.log(`  [multiplier] ${m.key}`);
  }

  // ── Checklisten ──
  const checklists = [
    {
      type: 'kaeuferpruefung',
      lang: 'de',
      items: [
        { id: 'k1',  category: 'vorbereitung',  text: 'Kauf-Budget und maximalen Kaufpreis festlegen', required: true,  helpText: 'Inkl. Reserve für Due-Diligence-Kosten (5–10k) und erste Betriebsmonate' },
        { id: 'k2',  category: 'vorbereitung',  text: 'Steuerberater und ggf. M&A-Anwalt bestellen', required: true,  helpText: 'Vor Unterzeichnung eines LOI oder NDA unbedingt einschalten' },
        { id: 'k3',  category: 'vorbereitung',  text: 'Finanzierungsart und -bereitschaft klären (Eigenkapital, KfW, Bank)', required: true,  helpText: 'KfW ERP-Gründerkredit für Nachfolge möglich' },
        { id: 'k4',  category: 'due_diligence', text: 'Jahresabschlüsse / EÜR der letzten 3 Jahre anfordern', required: true,  helpText: 'Mindestens letzte 2 Jahre, besser 3 Jahre' },
        { id: 'k5',  category: 'due_diligence', text: 'Aktuelle BWA (nicht älter als 3 Monate) anfordern', required: true,  helpText: '' },
        { id: 'k6',  category: 'due_diligence', text: 'Lagerbestand körperlich prüfen und bewerten', required: true,  helpText: 'Besonders wichtig: Verfallsdatum bei Verbrauchsgütern!' },
        { id: 'k7',  category: 'due_diligence', text: 'Kontoauszüge der letzten 12 Monate einsehen', required: true,  helpText: 'Zahlungsströme mit Umsatzangaben vergleichen' },
        { id: 'k8',  category: 'due_diligence', text: 'Offene Verbindlichkeiten und Forderungen prüfen', required: true,  helpText: '' },
        { id: 'k9',  category: 'due_diligence', text: 'Alle laufenden Verträge sichten (Lieferanten, Miete, Software)', required: true,  helpText: 'Kündigungsfristen, Laufzeiten, Übertragbarkeit' },
        { id: 'k10', category: 'recht',          text: 'Steuerliche Unbedenklichkeitsbescheinigung anfordern', required: true,  helpText: 'Käufer kann bei Finanzamt anfragen; schützt vor Steuerschulden des Vorgängers' },
        { id: 'k11', category: 'recht',          text: 'Domain-Eigentümerschaft im Whois prüfen', required: true,  helpText: '' },
        { id: 'k12', category: 'recht',          text: 'Markenrecherche DPMA', required: false, helpText: 'dpma.de/DPMAregister — ist die Marke eingetragen? Auf wen?' },
        { id: 'k13', category: 'recht',          text: 'Gewerbeschein und Erlaubnisse des Verkäufers prüfen', required: true,  helpText: 'Eigene Gewerbeanmeldung nach Übernahme nicht vergessen!' },
        { id: 'k14', category: 'it',             text: 'Shopify Store-Transfer prüfen / initiieren', required: true,  helpText: 'Über Shopify Partner-Dashboard oder Support' },
        { id: 'k15', category: 'it',             text: 'Zahlungsanbieter-Konten (Stripe, PayPal): neue Konten aufsetzen', required: true,  helpText: 'Konten sind nicht übertragbar — rechtzeitig planen!' },
        { id: 'k16', category: 'it',             text: 'E-Mail-Konten und Cloud-Zugänge übernehmen', required: true,  helpText: 'Google Workspace, Klaviyo, Meta Business Manager etc.' },
        { id: 'k17', category: 'abschluss',      text: 'Kaufvertrag durch Anwalt erstellen / prüfen lassen', required: true,  helpText: '' },
        { id: 'k18', category: 'abschluss',      text: 'Eigene Gewerbeanmeldung erledigt', required: true,  helpText: '' },
        { id: 'k19', category: 'abschluss',      text: 'Steuerberater über Betriebsübernahme informiert', required: true,  helpText: 'Eröffnungsbilanz, neue USt-ID' },
      ],
    },
    {
      type: 'due_diligence_legal',
      lang: 'de',
      items: [
        { id: 'l1', category: 'vertraege',    text: 'Alle Lieferantenverträge: Laufzeiten, Kündigungsfristen, Übertragbarkeit', required: true, helpText: '§ 414 BGB: Übertragung braucht Zustimmung' },
        { id: 'l2', category: 'vertraege',    text: 'Mietvertrag(räge): Restlaufzeit, Sonderkündigungsrechte bei Inhaberwechsel', required: true, helpText: '' },
        { id: 'l3', category: 'ip',           text: 'Alle IP-Rechte identifiziert (Marken, Designs, Domains, Urheberrechte)', required: true, helpText: '' },
        { id: 'l4', category: 'ip',           text: 'DPMA-Markenrecherche durchgeführt', required: true, helpText: 'dpma.de/DPMAregister' },
        { id: 'l5', category: 'haftung',      text: 'Laufende Rechtsstreitigkeiten / Abmahnungen recherchiert', required: true, helpText: 'Verkäufer zur Vollständigkeit verpflichten (Garantie im Kaufvertrag)' },
        { id: 'l6', category: 'haftung',      text: 'Produkthaftungsrisiken geprüft (inkl. Versicherungsschutz)', required: true, helpText: 'Bei Düngemitteln: Produktspezifikationen, Zulassungen (EG-Düngemittelverordnung)' },
        { id: 'l7', category: 'datenschutz',  text: 'DSGVO-Konformität der Kundendaten geprüft', required: true, helpText: 'Opt-In-Dokumentation, Datenschutzerklärung, Verarbeitungsverzeichnis' },
        { id: 'l8', category: 'datenschutz',  text: 'Datenübertragungs-Rechtsgrundlage (Art. 6 DSGVO) geprüft', required: true, helpText: 'Im Zweifel: neue Einwilligung der Kunden nach Übernahme' },
        { id: 'l9', category: 'personal',     text: '§ 613a BGB: Alle Arbeitnehmer inventarisiert', required: false, helpText: 'Nur wenn Mitarbeiter vorhanden; alle Verträge, offene Urlaubsansprüche, BAV' },
      ],
    },
  ];

  for (const cl of checklists) {
    await db.query(
      `INSERT INTO checklists (type, lang, items)
       VALUES ($1, $2, $3)
       ON CONFLICT (type, lang) DO UPDATE SET items=EXCLUDED.items, updated_at=NOW()`,
      [cl.type, cl.lang, JSON.stringify(cl.items)]
    );
    console.log(`  [checklist] ${cl.type} (${cl.lang})`);
  }

  console.log('\nSeed complete.');
  await db.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
