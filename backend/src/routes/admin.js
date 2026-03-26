'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const logger = require('../utils/logger');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────────
//  POST /api/admin/login
// ─────────────────────────────────────────────────
router.post('/login',
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid credentials format' });

        try {
            const { email, password } = req.body;
            const { rows } = await db.query(
                'SELECT id, email, password_hash, role, is_active FROM admin_users WHERE email = $1',
                [email]
            );

            if (!rows.length || !rows[0].is_active) {
                // Timing-safe: still run bcrypt to prevent user enumeration
                await bcrypt.compare(password, '$2b$12$invalidhashinvalidhashinvalidha');
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const valid = await bcrypt.compare(password, rows[0].password_hash);
            if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

            const token = jwt.sign(
                { sub: rows[0].id, email: rows[0].email, role: rows[0].role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
            );

            return res.json({ token, role: rows[0].role, email: rows[0].email });
        } catch (err) {
            logger.error('Admin login error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// ─────────────────────────────────────────────────
//  All routes below require authentication
// ─────────────────────────────────────────────────
router.use(requireAuth);

// GET /api/admin/me
router.get('/me', (req, res) => res.json(req.admin));

// ─────────────────────────────────────────────────
//  Knowledge CRUD
// ─────────────────────────────────────────────────

// GET /api/admin/knowledge  — list all (incl. inactive)
router.get('/knowledge', async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, category, slug, title_de, is_active, version, updated_at
       FROM knowledge_entries ORDER BY category, title_de`
        );
        return res.json(rows);
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/knowledge/:id
router.get('/knowledge/:id', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM knowledge_entries WHERE id = $1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        return res.json(rows[0]);
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/admin/knowledge — create
router.post('/knowledge', [
    body('category').isString().notEmpty(),
    body('slug').isString().matches(/^[a-z0-9_-]+$/),
    body('title_de').isString().notEmpty(),
    body('title_en').isString().notEmpty(),
    body('content_de').isString().notEmpty(),
    body('content_en').isString().notEmpty(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    try {
        const {
            category, subcategory, slug, title_de, title_en,
            content_de, content_en, summary_de, summary_en,
            source_url, source_law_paragraph, valid_from,
            tags = [], applies_to_rechtsformen = [],
        } = req.body;

        const { rows } = await db.query(
            `INSERT INTO knowledge_entries
         (category, subcategory, slug, title_de, title_en, content_de, content_en,
          summary_de, summary_en, source_url, source_law_paragraph, valid_from,
          tags, applies_to_rechtsformen, source_type, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'manual',$15,$15)
       RETURNING id, slug`,
            [category, subcategory, slug, title_de, title_en, content_de, content_en,
                summary_de, summary_en, source_url, source_law_paragraph, valid_from || null,
                tags, applies_to_rechtsformen, req.admin.id]
        );
        return res.status(201).json(rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/admin/knowledge/:id — update
router.patch('/knowledge/:id', async (req, res) => {
    const allowed = ['title_de', 'title_en', 'content_de', 'content_en', 'summary_de', 'summary_en',
        'source_url', 'source_law_paragraph', 'tags', 'applies_to_rechtsformen',
        'is_active', 'subcategory', 'valid_from', 'last_verified'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });

    try {
        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
        const values = [req.params.id, ...Object.values(updates)];
        await db.query(
            `UPDATE knowledge_entries
       SET ${setClauses}, version = version + 1, updated_by = ${req.admin.id}
       WHERE id = $1`,
            values
        );
        return res.json({ success: true });
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────
//  Pending KB proposals (from AI/Scraper)
// ─────────────────────────────────────────────────

router.get('/pending', async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT kp.*, ke.title_de, ke.category
       FROM knowledge_pending kp
       JOIN knowledge_entries ke ON ke.id = kp.knowledge_entry_id
       WHERE kp.status = 'pending'
       ORDER BY kp.scraper_run_at DESC`
        );
        return res.json(rows);
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/pending/:id/approve', async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT * FROM knowledge_pending WHERE id = $1 AND status = $2',
            [req.params.id, 'pending']
        );
        if (!rows.length) return res.status(404).json({ error: 'Proposal not found or already reviewed' });
        const proposal = rows[0];

        // Apply proposed changes
        await db.query(
            `UPDATE knowledge_entries SET
         content_de = COALESCE($1, content_de),
         content_en = COALESCE($2, content_en),
         summary_de = COALESCE($3, summary_de),
         summary_en = COALESCE($4, summary_en),
         source_url  = COALESCE($5, source_url),
         version = version + 1, updated_by = $6,
         last_verified = CURRENT_DATE
       WHERE id = $7`,
            [proposal.proposed_content_de, proposal.proposed_content_en,
            proposal.proposed_summary_de, proposal.proposed_summary_en,
            proposal.source_url, req.admin.id, proposal.knowledge_entry_id]
        );

        await db.query(
            `UPDATE knowledge_pending SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`,
            [req.admin.id, req.params.id]
        );

        return res.json({ success: true });
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/pending/:id/reject', async (req, res) => {
    try {
        await db.query(
            `UPDATE knowledge_pending SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`,
            [req.admin.id, req.params.id]
        );
        return res.json({ success: true });
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────
//  Scraper manual trigger (superadmin only)
// ─────────────────────────────────────────────────
router.post('/trigger-scraper', requireSuperAdmin, async (req, res) => {
    try {
        const { runScrapers } = require('../scrapers/cron');
        res.json({ message: 'Scraper started in background' });
        setImmediate(runScrapers); // non-blocking
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/scraper-log
router.get('/scraper-log', async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT * FROM scraper_runs ORDER BY run_at DESC LIMIT 50'
        );
        return res.json(rows);
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────
//  Industry multipliers CRUD
// ─────────────────────────────────────────────────
router.get('/multipliers', async (req, res) => {
    const { rows } = await db.query('SELECT * FROM industry_multipliers ORDER BY label_de');
    return res.json(rows);
});

router.patch('/multipliers/:key', async (req, res) => {
    const { ebitda_min, ebitda_max, ebitda_median, revenue_min, revenue_max, revenue_median, notes_de, notes_en, source } = req.body;
    try {
        await db.query(
            `UPDATE industry_multipliers
       SET ebitda_min=$1, ebitda_max=$2, ebitda_median=$3,
           revenue_min=$4, revenue_max=$5, revenue_median=$6,
           notes_de=$7, notes_en=$8, source=$9, last_updated=CURRENT_DATE
       WHERE industry_key=$10`,
            [ebitda_min, ebitda_max, ebitda_median, revenue_min, revenue_max, revenue_median,
                notes_de, notes_en, source, req.params.key]
        );
        return res.json({ success: true });
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────────
//  Admin user management (superadmin only)
// ─────────────────────────────────────────────────
router.post('/users', requireSuperAdmin,
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 12 }),
    body('role').isIn(['editor', 'superadmin']),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

        try {
            const hash = await bcrypt.hash(req.body.password, 12);
            const { rows } = await db.query(
                'INSERT INTO admin_users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
                [req.body.email, hash, req.body.role]
            );
            return res.status(201).json(rows[0]);
        } catch (err) {
            if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
            logger.error(err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
);

module.exports = router;
