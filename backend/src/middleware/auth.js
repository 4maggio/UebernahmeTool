'use strict';

const jwt = require('jsonwebtoken');
const db = require('../db');
const logger = require('../utils/logger');

/**
 * Middleware: verify JWT token in Authorization header.
 * Attaches req.user = { id, username, role } on success.
 * Legacy alias req.admin is also set for backward compatibility.
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

        // Confirm user still exists and is active
        const { rows } = await db.query(
            'SELECT id, username, email, role, is_active FROM users WHERE id = $1',
            [payload.sub]
        );
        if (!rows.length || !rows[0].is_active) {
            return res.status(401).json({ error: 'Unauthorized: account not found or disabled' });
        }

        const user = { id: rows[0].id, username: rows[0].username, role: rows[0].role };
        req.user = user;
        req.admin = user; // backward compat for admin routes
        next();
    } catch (err) {
        logger.error('Auth middleware error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Middleware factory: require one of the given roles.
 * Must be used after requireAuth.
 *
 * Usage: requireRole('manager', 'admin')
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.status(403).json({ error: `Forbidden: requires role ${roles.join(' or ')}` });
        }
        next();
    };
}

// Legacy alias
const requireSuperAdmin = requireRole('admin');

module.exports = { requireAuth, requireRole, requireSuperAdmin };
