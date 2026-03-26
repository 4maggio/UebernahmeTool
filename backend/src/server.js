'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const logger = require('./utils/logger');
const analysisRoutes = require('./routes/analysis');
const checklistRoutes = require('./routes/checklist');
const knowledgeRoutes = require('./routes/knowledge');
const adminRoutes = require('./routes/admin');

// Scrapers / cron (initialise after server starts)
const { initScraperCron } = require('./scrapers/cron');

const app = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  Security headers
// ──────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],   // inline scripts in admin.html
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
        },
    },
}));

// ──────────────────────────────────────────────
//  CORS
// ──────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim());

app.use(cors({
    origin: (origin, cb) => {
        // Allow no-origin requests: same-origin browser fetches don't include Origin header
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS policy blocked origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

// ──────────────────────────────────────────────
//  Rate limiting
// ──────────────────────────────────────────────
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stricter limit on auth endpoints
app.use('/api/admin/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts.' },
}));

// ──────────────────────────────────────────────
//  Body parsing & compression
// ──────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ──────────────────────────────────────────────
//  API routes
// ──────────────────────────────────────────────
app.use('/api/analysis', analysisRoutes);
app.use('/api/checklist', checklistRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/admin', adminRoutes);

// ──────────────────────────────────────────────
//  Static frontend (production)
// ──────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
    const frontendDir = path.resolve(__dirname, '../../frontend');
    app.use(express.static(frontendDir, {
        maxAge: '1d',
        etag: true,
    }));
    // SPA fallback — do NOT serve admin.html via catch-all
    app.get('/', (req, res) =>
        res.sendFile(path.join(frontendDir, 'index.html'))
    );
    app.get('/admin', (req, res) =>
        res.sendFile(path.join(frontendDir, 'admin.html'))
    );
}

// ──────────────────────────────────────────────
//  Health check
// ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ──────────────────────────────────────────────
//  404 & global error handler
// ──────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    logger.error(err);
    const status = err.status || 500;
    res.status(status).json({
        error: process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : err.message,
    });
});

// ──────────────────────────────────────────────
//  Start
// ──────────────────────────────────────────────
app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    if (process.env.SCRAPER_ENABLED === 'true') {
        initScraperCron();
        logger.info('Scraper cron initialised.');
    }
});

module.exports = app; // for testing
