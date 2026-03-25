'use strict';

const express = require('express');
const db      = require('../db');
const logger  = require('../utils/logger');

const router = express.Router();

// ─────────────────────────────────────
//  GET /api/checklist/:type
//  Checkliste nach Typ abrufen
// ─────────────────────────────────────
router.get('/:type', async (req, res) => {
  const { lang = 'de' } = req.query;
  try {
    const { rows } = await db.query(
      `SELECT type, lang, version, items, updated_at
       FROM checklists WHERE type = $1 AND lang = $2`,
      [req.params.type, lang]
    );
    if (!rows.length) return res.status(404).json({ error: 'Checklist not found' });
    return res.json(rows[0]);
  } catch (err) {
    logger.error('Checklist fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────
//  POST /api/checklist/generate
//  Dynamische Checkliste basierend auf Session-Daten
// ─────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { legalForm, industryKey, employeeCount, hasRealEstate, lang = 'de' } = req.body;

  try {
    // Load all checklist types relevant for this company profile
    const relevantTypes = ['kaeuferpruefung', 'due_diligence_financial', 'due_diligence_legal'];

    if (employeeCount > 0)  relevantTypes.push('due_diligence_hr');
    if (hasRealEstate)       relevantTypes.push('due_diligence_real_estate');
    if (['GmbH', 'UG'].includes(legalForm)) relevantTypes.push('share_deal_specific');

    const { rows } = await db.query(
      `SELECT type, items FROM checklists
       WHERE type = ANY($1) AND lang = $2`,
      [relevantTypes, lang]
    );

    // Merge and annotate items
    const merged = [];
    for (const row of rows) {
      const items = Array.isArray(row.items) ? row.items : [];
      merged.push(...items.map(item => ({ ...item, checklistType: row.type })));
    }

    return res.json({ items: merged, lang, profile: { legalForm, industryKey, employeeCount } });
  } catch (err) {
    logger.error('Checklist generate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
