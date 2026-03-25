'use strict';

/**
 * Scraper: gesetze-im-internet.de
 * Holt definierte Gesetzesparagraphen und speichert Änderungen
 * als pending KB-Updates zur Admin-Freigabe.
 *
 * Quellen: Bundesamt für Justiz — öffentlich, keine ToS-Einschränkung
 */

const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const db      = require('../db');
const logger  = require('../utils/logger');
const ai      = require('./aiService');

// Paragraphen, die gescraped werden sollen
const GESETZE_TARGETS = [
  { url: 'https://www.gesetze-im-internet.de/bgb/__453.html',   paragraph: '§ 453 BGB',  slug: 'recht-par453-bgb' },
  { url: 'https://www.gesetze-im-internet.de/bgb/__413.html',   paragraph: '§ 413 BGB',  slug: 'recht-par413-bgb' },
  { url: 'https://www.gesetze-im-internet.de/bgb/__414.html',   paragraph: '§ 414 BGB',  slug: 'recht-par414-bgb' },
  { url: 'https://www.gesetze-im-internet.de/bgb/__613a.html',  paragraph: '§ 613a BGB', slug: 'recht-par613a-bgb' },
  { url: 'https://www.gesetze-im-internet.de/bgb/__705.html',   paragraph: '§ 705 BGB',  slug: 'rechtsform-gbr-par705' },
  { url: 'https://www.gesetze-im-internet.de/hgb/__25.html',    paragraph: '§ 25 HGB',   slug: 'recht-par25-hgb' },
  { url: 'https://www.gesetze-im-internet.de/hgb/__22.html',    paragraph: '§ 22 HGB',   slug: 'recht-par22-hgb' },
  { url: 'https://www.gesetze-im-internet.de/estg/__16.html',   paragraph: '§ 16 EStG',  slug: 'steuer-par16-estg' },
  { url: 'https://www.gesetze-im-internet.de/estg/__34.html',   paragraph: '§ 34 EStG',  slug: 'steuer-par34-estg' },
  { url: 'https://www.gesetze-im-internet.de/bewg/__199.html',  paragraph: '§ 199 BewG', slug: 'bewertung-par199-bewg' },
  { url: 'https://www.gesetze-im-internet.de/bewg/__203.html',  paragraph: '§ 203 BewG', slug: 'bewertung-par203-bewg' },
  { url: 'https://www.gesetze-im-internet.de/gmbhg/__15.html',  paragraph: '§ 15 GmbHG', slug: 'rechtsform-gmbh-par15' },
];

/**
 * Scrapt eine einzelne Gesetzesseite und extrahiert den Gesetzestext.
 */
async function scrapeGesetze(target) {
  const response = await fetch(target.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UebernahmeTool/1.0; +https://github.com)' },
    timeout: 15000,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${target.url}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  // gesetze-im-internet.de: Die Normen sind in <div class="jnhtml">
  const content = $('div.jnhtml').text().replace(/\s+/g, ' ').trim();
  if (!content) throw new Error(`No content extracted from ${target.url}`);

  return content;
}

/**
 * Vergleicht gegen DB und erstellt bei Änderung einen pending Vorschlag.
 */
async function processTarget(target) {
  const scrapedText = await scrapeGesetze(target);

  // Lookup existing KB entry
  const { rows } = await db.query(
    'SELECT id, content_de FROM knowledge_entries WHERE slug = $1 AND is_active = TRUE',
    [target.slug]
  );

  if (!rows.length) {
    logger.debug(`[gesetze] No KB entry found for slug: ${target.slug} — skipping`);
    return { status: 'no_entry_found' };
  }

  const existing = rows[0];

  // Simple diff: if scraped text length differs by > 50 chars, treat as changed
  const changed = Math.abs(scrapedText.length - existing.content_de.length) > 50;
  if (!changed) {
    return { status: 'no_change' };
  }

  // AI-Verarbeitung: strukturierten KB-Update-Vorschlag erstellen
  const proposal = await ai.generateKbUpdateProposal(target.paragraph, scrapedText, target.url);

  if (!proposal) return { status: 'ai_failed' };

  await db.query(
    `INSERT INTO knowledge_pending
       (knowledge_entry_id, proposed_content_de, proposed_content_en,
        proposed_summary_de, proposed_summary_en, source_url, source_law_paragraph, diff_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [existing.id, proposal.content_de, proposal.content_en,
     proposal.summary_de, proposal.summary_en,
     target.url, target.paragraph, proposal.diff_summary]
  );

  return { status: 'proposal_created' };
}

/**
 * Führt alle Targets durch, protokolliert Ergebnisse.
 */
async function run() {
  const start       = Date.now();
  let scraped       = 0;
  let changesFound  = 0;
  let errorMessage  = null;

  logger.info('[gesetze-scraper] Starting run...');

  try {
    for (const target of GESETZE_TARGETS) {
      try {
        const result = await processTarget(target);
        scraped++;
        if (result.status === 'proposal_created') changesFound++;
        logger.debug(`[gesetze-scraper] ${target.paragraph}: ${result.status}`);
      } catch (err) {
        logger.warn(`[gesetze-scraper] Error for ${target.paragraph}: ${err.message}`);
      }
      // Politeness delay: 1 second between requests
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err) {
    errorMessage = err.message;
    logger.error('[gesetze-scraper] Fatal error:', err);
  }

  const duration = Date.now() - start;
  await db.query(
    `INSERT INTO scraper_runs (scraper_name, status, pages_scraped, changes_found, error_message, duration_ms)
     VALUES ('gesetze', $1, $2, $3, $4, $5)`,
    [errorMessage ? 'error' : 'success', scraped, changesFound, errorMessage, duration]
  );

  logger.info(`[gesetze-scraper] Done. ${scraped} scraped, ${changesFound} proposals created (${duration}ms)`);
  return { scraped, changesFound };
}

module.exports = { run };
