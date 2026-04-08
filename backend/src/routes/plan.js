'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const ExcelJS = require('exceljs');
const db = require('../db');
const logger = require('../utils/logger');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All plan routes require auth
router.use(requireAuth);

// ──────────────────────────────────────────────
//  PUT /api/plan/draft
//  Upsert a named plan (owned by current user)
// ──────────────────────────────────────────────
router.put('/draft', [
    body('planId').isString().trim().notEmpty(),
    body('name').isString().trim().isLength({ min: 1, max: 200 }),
    body('data').isObject(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
        const { planId, name, data } = req.body;

        // Ensure user can only save to their own plan (or new)
        const { rows: existing } = await db.query(
            'SELECT created_by FROM plan_drafts WHERE plan_id = $1 AND deleted_at IS NULL',
            [planId]
        );
        if (existing.length > 0 && existing[0].created_by !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Kein Zugriff auf diesen Plan.' });
        }

        await db.query(
            `INSERT INTO plan_drafts (plan_id, name, data, created_by, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (plan_id) DO UPDATE
             SET name = $2, data = $3, updated_at = NOW()`,
            [planId, name.trim(), JSON.stringify(data), req.user.id]
        );

        res.json({ ok: true, planId });
    } catch (err) {
        logger.error('Plan save failed', err);
        res.status(500).json({ error: 'Plan konnte nicht gespeichert werden.' });
    }
});

// ──────────────────────────────────────────────
//  GET /api/plan/drafts
//  List plans for current user (admin: all)
// ──────────────────────────────────────────────
router.get('/drafts', async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'admin') {
            query = `SELECT p.plan_id, p.name, p.created_at, p.updated_at, u.username AS owner
                     FROM plan_drafts p
                     LEFT JOIN users u ON u.id = p.created_by
                     WHERE p.deleted_at IS NULL
                     ORDER BY p.updated_at DESC`;
            params = [];
        } else {
            query = `SELECT plan_id, name, created_at, updated_at
                     FROM plan_drafts
                     WHERE created_by = $1 AND deleted_at IS NULL
                     ORDER BY updated_at DESC`;
            params = [req.user.id];
        }
        const { rows } = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        logger.error('Plan list failed', err);
        res.status(500).json({ error: 'Pläne konnten nicht geladen werden.' });
    }
});

// ──────────────────────────────────────────────
//  GET /api/plan/draft/:id
//  Load a specific plan
// ──────────────────────────────────────────────
router.get('/draft/:id', [
    param('id').isString().trim().notEmpty(),
], async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT plan_id, name, data, created_by, created_at, updated_at FROM plan_drafts WHERE plan_id = $1 AND deleted_at IS NULL',
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Plan nicht gefunden.' });

        const row = rows[0];
        if (req.user.role !== 'admin' && row.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Kein Zugriff auf diesen Plan.' });
        }

        res.json({ planId: row.plan_id, name: row.name, data: row.data, createdAt: row.created_at, updatedAt: row.updated_at });
    } catch (err) {
        logger.error('Plan load failed', err);
        res.status(500).json({ error: 'Plan konnte nicht geladen werden.' });
    }
});

// ──────────────────────────────────────────────
//  DELETE /api/plan/draft/:id
//  Soft-delete (manager+)
// ──────────────────────────────────────────────
router.delete('/draft/:id', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT id, created_by FROM plan_drafts WHERE plan_id = $1 AND deleted_at IS NULL',
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Plan nicht gefunden.' });

        if (req.user.role === 'manager' && rows[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Nur eigene Pläne können gelöscht werden.' });
        }

        await db.query(
            'UPDATE plan_drafts SET deleted_at = NOW() WHERE plan_id = $1',
            [req.params.id]
        );
        res.json({ ok: true });
    } catch (err) {
        logger.error('Plan delete failed', err);
        res.status(500).json({ error: 'Plan konnte nicht gelöscht werden.' });
    }
});

// ──────────────────────────────────────────────
//  POST /api/plan/export/xlsx
//  Generate XLSX from computed plan data
// ──────────────────────────────────────────────
router.post('/export/xlsx', [
    body('rows').isArray(),
    body('years').isArray(),
    body('planName').optional().isString(),
    body('scenario').optional().isString(),
    body('historyRows').optional().isArray(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
        const { rows, years, planName, scenario, historyRows, loanRows, kpis } = req.body;

        const wb = new ExcelJS.Workbook();
        wb.creator = 'bäste Übernahme-Tool';
        wb.created = new Date();

        // ── Brand colors ───────────────────────────────────────────
        const BLUE_DARK  = '1A56DB';
        const BLUE_LIGHT = 'E8F0FD';
        const GREEN      = '057A55';
        const GREEN_BG   = 'DEF7EC';
        const RED        = '9B1C1C';
        const RED_BG     = 'FDE8E8';
        const GREY_BG    = 'F3F4F6';
        const HEADER_BG  = '111827';
        const HEADER_FG  = 'FFFFFF';

        const boldFont = { bold: true };
        const headerFont = { bold: true, color: { argb: HEADER_FG } };

        function headerFill(color = HEADER_BG) {
            return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        }
        function lightFill(color) {
            return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        }
        function eurFormat() { return '#,##0 "€"'; }
        function pctFormat() { return '0.0"%"'; }

        function borderAll() {
            const s = { style: 'thin', color: { argb: 'D1D5DB' } };
            return { top: s, left: s, bottom: s, right: s };
        }

        function applyHeaderRow(ws, rowNum, values, bgColor = HEADER_BG) {
            const row = ws.getRow(rowNum);
            values.forEach((v, i) => {
                const cell = row.getCell(i + 1);
                cell.value = v;
                cell.font = headerFont;
                cell.fill = headerFill(bgColor);
                cell.border = borderAll();
                cell.alignment = i === 0 ? { horizontal: 'left' } : { horizontal: 'right' };
            });
            row.commit();
        }

        function applyDataRow(ws, rowNum, values, options = {}) {
            const row = ws.getRow(rowNum);
            values.forEach((v, i) => {
                const cell = row.getCell(i + 1);
                cell.value = v;
                cell.border = borderAll();
                cell.alignment = i === 0 ? { horizontal: 'left' } : { horizontal: 'right' };
                if (options.bold) cell.font = boldFont;
                if (options.bgColor) cell.fill = lightFill(options.bgColor);
                if (i > 0 && options.eurFormat !== false) cell.numFmt = eurFormat();
                if (i > 0 && options.pctFormat) cell.numFmt = pctFormat();
                if (i > 0 && typeof v === 'number') {
                    if (v < 0 && !options.noColor) cell.font = { ...(options.bold ? boldFont : {}), color: { argb: RED } };
                    if (v > 0 && options.green) cell.font = { ...(options.bold ? boldFont : {}), color: { argb: GREEN } };
                }
            });
            row.commit();
        }

        const yearLabels = years.map(String);
        const colCount = years.length + 2; // label + N years + total

        // ── Sheet 1: GuV Übersicht ─────────────────────────────────
        const ws1 = wb.addWorksheet('GuV Übersicht');
        ws1.columns = [
            { key: 'label', width: 36 },
            ...years.map((y, i) => ({ key: `y${i}`, width: 16 })),
            { key: 'total', width: 16 },
        ];

        // Title
        ws1.mergeCells(1, 1, 1, colCount);
        const titleCell = ws1.getCell('A1');
        titleCell.value = `5-Jahres-Plan: ${planName || 'Plan'} — Szenario: ${scenario || 'Basis'}`;
        titleCell.font = { bold: true, size: 13, color: { argb: HEADER_FG } };
        titleCell.fill = headerFill();
        titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
        ws1.getRow(1).height = 28;

        ws1.addRow([]); // spacer

        // Column headers
        applyHeaderRow(ws1, 3, ['Position', ...yearLabels, 'Gesamt']);
        ws1.getRow(3).height = 20;

        let r = 4;
        for (const row of (rows || [])) {
            if (row.section) {
                ws1.mergeCells(r, 1, r, colCount);
                const c = ws1.getCell(r, 1);
                c.value = row.label;
                c.font = { bold: true, size: 9, color: { argb: '6B7280' } };
                c.fill = lightFill(GREY_BG);
                c.border = borderAll();
                ws1.getRow(r).height = 16;
                r++;
                continue;
            }
            const isHighlight = row.highlight;
            const isTotal = row.total;
            const sum = row.pct
                ? (row.vals.reduce((a, b) => a + b, 0) / row.vals.length)
                : row.vals.reduce((a, b) => a + b, 0);
            const values = [row.label, ...row.vals, sum];
            applyDataRow(ws1, r, values, {
                bold: row.bold || isTotal || isHighlight,
                bgColor: isHighlight ? BLUE_LIGHT : isTotal ? GREY_BG : null,
                pctFormat: row.pct,
                eurFormat: !row.pct,
                green: isHighlight || isTotal,
            });
            ws1.getRow(r).height = 18;
            r++;
        }

        // ── Sheet 2: Finanzierung ──────────────────────────────────
        const ws2 = wb.addWorksheet('Finanzierung');
        ws2.columns = [{ key: 'label', width: 32 }, ...years.map(() => ({ width: 16 })), { width: 16 }];

        ws2.mergeCells(1, 1, 1, colCount);
        ws2.getCell('A1').value = 'Tilgungsplan';
        ws2.getCell('A1').font = { bold: true, size: 13, color: { argb: HEADER_FG } };
        ws2.getCell('A1').fill = headerFill();
        ws2.getRow(1).height = 28;
        ws2.addRow([]);
        applyHeaderRow(ws2, 3, ['Position', ...yearLabels, 'Gesamt']);

        let r2 = 4;
        for (const row of (loanRows || [])) {
            if (row.section) { r2++; continue; }
            const sum = row.vals.reduce((a, b) => a + b, 0);
            applyDataRow(ws2, r2, [row.label, ...row.vals, sum], { bold: row.bold || row.total, bgColor: row.total ? GREY_BG : null });
            r2++;
        }

        // ── Sheet 3: KPIs ──────────────────────────────────────────
        const ws3 = wb.addWorksheet('KPIs');
        ws3.columns = [{ width: 36 }, { width: 24 }];

        ws3.mergeCells(1, 1, 1, 2);
        ws3.getCell('A1').value = 'Zusammenfassung KPIs';
        ws3.getCell('A1').font = { bold: true, size: 13, color: { argb: HEADER_FG } };
        ws3.getCell('A1').fill = headerFill();
        ws3.getRow(1).height = 28;

        let r3 = 2;
        for (const kpi of (kpis || [])) {
            const row = ws3.getRow(r3);
            const c1 = row.getCell(1);
            const c2 = row.getCell(2);
            c1.value = kpi.label;
            c1.border = borderAll();
            c1.font = { bold: true };
            c2.value = kpi.value;
            c2.border = borderAll();
            c2.alignment = { horizontal: 'right' };
            if (typeof kpi.value === 'number') c2.numFmt = eurFormat();
            row.commit();
            r3++;
        }

        // ── Sheet 4: Historische Monate (optional) ─────────────────
        if (historyRows && historyRows.length > 0) {
            const ws4 = wb.addWorksheet('Ist-Daten');
            ws4.columns = [{ width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }];

            ws4.mergeCells(1, 1, 1, 4);
            ws4.getCell('A1').value = 'Historische Monatsdaten (Ist)';
            ws4.getCell('A1').font = { bold: true, size: 13, color: { argb: HEADER_FG } };
            ws4.getCell('A1').fill = headerFill();
            ws4.getRow(1).height = 28;

            applyHeaderRow(ws4, 2, ['Monat', 'Einnahmen (€)', 'Ausgaben (€)', 'Ergebnis (€)'], HEADER_BG);

            let r4 = 3;
            for (const hRow of historyRows) {
                const result = (hRow.revenue || 0) - (hRow.costs || 0);
                applyDataRow(ws4, r4, [hRow.label, hRow.revenue || 0, hRow.costs || 0, result], {
                    green: result > 0,
                    noColor: false,
                });
                r4++;
            }
        }

        // Write to response
        const name = (planName || 'Plan').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="5Jahresplan_${name}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (err) {
        logger.error('Plan XLSX export failed', err);
        res.status(500).json({ error: 'XLSX-Export fehlgeschlagen.' });
    }
});

module.exports = router;
