'use strict';

const express   = require('express');
const { body, validationResult } = require('express-validator');
const db        = require('../db');
const valuation = require('../services/valuation');
const logger    = require('../utils/logger');

const router = express.Router();

// ─────────────────────────────────
//  POST /api/analysis
//  Vollständige Unternehmens-Analyse
// ─────────────────────────────────
const analysisValidation = [
  body('legalForm').isString().notEmpty(),
  body('industryKey').isString().notEmpty(),
  body('financials').isObject(),
  body('financials.ebitda').optional().isNumeric(),
  body('financials.revenueYear1').optional().isNumeric(),
  body('assets').optional().isObject(),
  body('taxParams').optional().isObject(),
  body('lang').optional().isIn(['de', 'en']),
];

router.post('/', analysisValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  try {
    const result = await valuation.calculate(req.body);

    // Persist anonymised session (no personal data required)
    const sessionData = sanitiseForStorage(req.body);
    const { rows } = await db.query(
      `INSERT INTO analysis_sessions (session_data, result, lang)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [JSON.stringify(sessionData), JSON.stringify(result), req.body.lang || 'de']
    );

    return res.json({ sessionId: rows[0].id, ...result });
  } catch (err) {
    logger.error('Analysis error:', err);
    return res.status(500).json({ error: 'Analyse konnte nicht berechnet werden.' });
  }
});

// ─────────────────────────────────
//  GET /api/analysis/:sessionId
//  Ergebnis einer Session abrufen
// ─────────────────────────────────
router.get('/:sessionId', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, session_data, result, lang, created_at
       FROM analysis_sessions
       WHERE id = $1 AND expires_at > NOW()`,
      [req.params.sessionId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found or expired' });
    return res.json(rows[0]);
  } catch (err) {
    logger.error('Get session error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: remove potential PII before DB storage
function sanitiseForStorage(data) {
  const clean = JSON.parse(JSON.stringify(data));
  delete clean.companyName;        // optional; user can omit
  delete clean.taxParams?.email;
  return clean;
}

module.exports = router;
