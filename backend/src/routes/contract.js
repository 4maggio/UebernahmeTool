'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const jsYaml = require('js-yaml');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const contractGenerator = require('../services/contractGenerator');
const contractExport = require('../services/contractExport');

// ──────────────────────────────────────────────
//  Load YAML template once at startup
// ──────────────────────────────────────────────
const TEMPLATE_PATH = path.join(__dirname, '../../contracts/templates/asset_kaufvertrag.yaml');
let templateCache = null;

function getTemplate() {
    if (!templateCache) {
        const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
        templateCache = jsYaml.load(raw);
    }
    return templateCache;
}

// ──────────────────────────────────────────────
//  GET /api/contract/template
//  Returns wizard_steps + variables for the frontend
// ──────────────────────────────────────────────
router.get('/template', (req, res) => {
    try {
        const tpl = getTemplate();
        res.json({
            meta: tpl.meta,
            variables: tpl.variables,
            wizard_steps: tpl.module_config.wizard_steps,
            presets: tpl.module_config.presets,
        });
    } catch (err) {
        logger.error('Failed to load contract template', err);
        res.status(500).json({ error: 'Vorlage konnte nicht geladen werden.' });
    }
});

// ──────────────────────────────────────────────
//  POST /api/contract/generate
//  Generate contract text from user data
// ──────────────────────────────────────────────
router.post('/generate', [
    body().isObject().withMessage('Body must be an object'),
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    try {
        const tpl = getTemplate();
        const contractText = contractGenerator.generate(tpl, req.body);
        res.json({ contract: contractText });
    } catch (err) {
        logger.error('Contract generation failed', err);
        res.status(500).json({ error: 'Vertragsgenerierung fehlgeschlagen.' });
    }
});

// ──────────────────────────────────────────────
//  POST /api/contract/export/:format
//  Export contract as PDF or DOCX
// ──────────────────────────────────────────────
router.post('/export/:format', [
    body().isObject().withMessage('Body must be an object'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const format = req.params.format;
    if (!['pdf', 'docx'].includes(format)) {
        return res.status(400).json({ error: 'Format muss pdf oder docx sein.' });
    }

    try {
        const tpl = getTemplate();
        const contractText = contractGenerator.generate(tpl, req.body);
        const name = (req.body.UNTERNEHMENSNAME || 'Kaufvertrag').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');

        if (format === 'docx') {
            const buffer = await contractExport.toDocx(contractText, req.body);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="Asset_Kaufvertrag_${name}.docx"`);
            res.send(buffer);
        } else {
            const buffer = await contractExport.toPdf(contractText, req.body);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Asset_Kaufvertrag_${name}.pdf"`);
            res.send(buffer);
        }
    } catch (err) {
        logger.error(`Contract export (${format}) failed`, err);
        res.status(500).json({ error: 'Export fehlgeschlagen.' });
    }
});

// ──────────────────────────────────────────────
//  PUT /api/contract/draft
//  Save draft to database (optional backend sync)
// ──────────────────────────────────────────────
router.put('/draft', [
    body('draftId').isString().notEmpty(),
    body('data').isObject(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const db = require('../db');
        const { draftId, data, currentStep } = req.body;

        await db.query(
            `INSERT INTO contract_drafts (draft_id, data, current_step, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (draft_id) DO UPDATE
             SET data = $2, current_step = $3, updated_at = NOW()`,
            [draftId, JSON.stringify(data), currentStep || 0]
        );

        res.json({ ok: true });
    } catch (err) {
        logger.error('Draft save failed', err);
        res.status(500).json({ error: 'Entwurf konnte nicht gespeichert werden.' });
    }
});

// ──────────────────────────────────────────────
//  GET /api/contract/draft/:id
//  Load a draft from database
// ──────────────────────────────────────────────
router.get('/draft/:id', async (req, res) => {
    try {
        const db = require('../db');
        const result = await db.query(
            'SELECT draft_id, data, current_step, created_at, updated_at FROM contract_drafts WHERE draft_id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entwurf nicht gefunden.' });
        }
        const row = result.rows[0];
        res.json({
            draftId: row.draft_id,
            data: row.data,
            currentStep: row.current_step,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    } catch (err) {
        logger.error('Draft load failed', err);
        res.status(500).json({ error: 'Entwurf konnte nicht geladen werden.' });
    }
});

module.exports = router;
