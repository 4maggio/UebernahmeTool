'use strict';

/**
 * KB Import Script: liest alle YAML-Dateien aus /backend/knowledge/**
 * und upserted sie in die PostgreSQL-Datenbank.
 *
 * Usage: npm run kb:import
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../../.env') });
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const db   = require('../index');

const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');

async function importKnowledge() {
  console.log(`Scanning: ${KNOWLEDGE_DIR}`);
  const files = listYamlFiles(KNOWLEDGE_DIR);
  console.log(`Found ${files.length} YAML file(s).`);

  let inserted = 0, updated = 0, errors = 0;

  for (const filePath of files) {
    try {
      const raw    = fs.readFileSync(filePath, 'utf8');
      const entry  = yaml.load(raw);

      if (!entry.slug || !entry.category || !entry.title_de) {
        console.warn(`  [skip] ${filePath} — missing required fields (slug, category, title_de)`);
        continue;
      }

      // Upsert by slug
      const existing = await db.query('SELECT id, version FROM knowledge_entries WHERE slug = $1', [entry.slug]);

      if (existing.rows.length === 0) {
        await db.query(
          `INSERT INTO knowledge_entries
             (category, subcategory, slug, title_de, title_en,
              content_de, content_en, summary_de, summary_en,
              source_url, source_law_paragraph, valid_from, last_verified,
              tags, applies_to_rechtsformen, source_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual')`,
          [
            entry.category,
            entry.subcategory || null,
            entry.slug,
            entry.title_de,
            entry.title_en || entry.title_de,
            entry.content_de || '',
            entry.content_en || entry.content_de || '',
            entry.summary_de || null,
            entry.summary_en || null,
            entry.source_url || null,
            entry.source_law_paragraph || null,
            entry.valid_from || null,
            entry.last_verified || null,
            entry.tags || [],
            entry.applies_to_rechtsformen || [],
          ]
        );
        console.log(`  [insert] ${entry.slug}`);
        inserted++;
      } else {
        await db.query(
          `UPDATE knowledge_entries
           SET category=$1, subcategory=$2, title_de=$3, title_en=$4,
               content_de=$5, content_en=$6, summary_de=$7, summary_en=$8,
               source_url=$9, source_law_paragraph=$10, last_verified=$11,
               tags=$12, applies_to_rechtsformen=$13,
               version = version + 1, updated_at = NOW()
           WHERE slug=$14`,
          [
            entry.category,
            entry.subcategory || null,
            entry.title_de,
            entry.title_en || entry.title_de,
            entry.content_de || '',
            entry.content_en || entry.content_de || '',
            entry.summary_de || null,
            entry.summary_en || null,
            entry.source_url || null,
            entry.source_law_paragraph || null,
            entry.last_verified || null,
            entry.tags || [],
            entry.applies_to_rechtsformen || [],
            entry.slug,
          ]
        );
        console.log(`  [update] ${entry.slug} (v${existing.rows[0].version + 1})`);
        updated++;
      }
    } catch (err) {
      console.error(`  [error] ${filePath}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nImport complete: ${inserted} inserted, ${updated} updated, ${errors} errors.`);
  await db.end();
}

function listYamlFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listYamlFiles(fullPath));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      results.push(fullPath);
    }
  }
  return results;
}

importKnowledge().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
