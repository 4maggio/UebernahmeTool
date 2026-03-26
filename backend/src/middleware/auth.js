'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');
const logger = require('../utils/logger');

/**
 * Middleware: verify JWT token in Authorization header.
 * Attaches req.admin = { id, email, role } on success.
 */
async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: missing token' });
        }

        const token = authHeader.slice(7);
        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
        }

        // Confirm admin still exists and is active
        const { rows } = await db.query(
            'SELECT id, email, role, is_active FROM admin_users WHERE id = $1',
            [payload.sub]
        );
        if (!rows.length || !rows[0].is_active) {
            return res.status(401).json({ error: 'Unauthorized: account not found or disabled' });
        }

        req.admin = { id: rows[0].id, email: rows[0].email, role: rows[0].role };
        next();
    } catch (err) {
        logger.error('Auth middleware error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Middleware: require superadmin role.
 * Must be used after requireAuth.
 */
function requireSuperAdmin(req, res, next) {
    if (req.admin?.role !== 'superadmin') {
        return res.status(403).json({ error: 'Forbidden: superadmin role required' });
    }
    next();
}

module.exports = { requireAuth, requireSuperAdmin };
