'use strict';

const express = require('express');
const db = require('../db');
const logger = require('../utils/logger');

const router = express.Router();

// ─────────────────────────────────────
//  GET /api/knowledge
//  Alle Einträge einer Kategorie
// ─────────────────────────────────────
router.get('/', async (req, res) => {
    const { category, lang = 'de', rechtsform } = req.query;

    try {
        let sql = `
      SELECT id, category, subcategory, slug,
             title_de, title_en,
             summary_de, summary_en,
             source_law_paragraph, tags, applies_to_rechtsformen,
             last_verified, version
      FROM knowledge_entries
      WHERE is_active = TRUE
    `;
        const params = [];

        if (category) {
            params.push(category);
            sql += ` AND category = $${params.length}`;
        }

        if (rechtsform) {
            params.push(rechtsform);
            sql += ` AND (applies_to_rechtsformen = '{}' OR $${params.length} = ANY(applies_to_rechtsformen))`;
        }

        sql += ' ORDER BY category, subcategory, title_de';

        const { rows } = await db.query(sql, params);

        // Return summary fields only for listing; full content via /api/knowledge/:slug
        const result = rows.map(r => ({
            id: r.id,
            category: r.category,
            subcategory: r.subcategory,
            slug: r.slug,
            title: lang === 'en' ? r.title_en : r.title_de,
            summary: lang === 'en' ? r.summary_en : r.summary_de,
            sourceParagraph: r.source_law_paragraph,
            tags: r.tags,
            lastVerified: r.last_verified,
            version: r.version,
        }));

        return res.json(result);
    } catch (err) {
        logger.error('Knowledge list error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────
//  GET /api/knowledge/:slug
//  Vollständiger KB-Eintrag
// ─────────────────────────────────────
router.get('/:slug', async (req, res) => {
    const { lang = 'de' } = req.query;
    try {
        const { rows } = await db.query(
            `SELECT * FROM knowledge_entries WHERE slug = $1 AND is_active = TRUE`,
            [req.params.slug]
        );
        if (!rows.length) return res.status(404).json({ error: 'Entry not found' });

        const r = rows[0];
        return res.json({
            id: r.id,
            category: r.category,
            subcategory: r.subcategory,
            slug: r.slug,
            title: lang === 'en' ? r.title_en : r.title_de,
            content: lang === 'en' ? r.content_en : r.content_de,
            summary: lang === 'en' ? r.summary_en : r.summary_de,
            sourceParagraph: r.source_law_paragraph,
            sourceUrl: r.source_url,
            tags: r.tags,
            appliesTo: r.applies_to_rechtsformen,
            lastVerified: r.last_verified,
            version: r.version,
        });
    } catch (err) {
        logger.error('Knowledge detail error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
