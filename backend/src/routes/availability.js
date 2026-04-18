'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const dns = require('dns').promises;
const fetch = require('node-fetch');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// ── Social media platform definitions ────────────────────────────
const PLATFORMS = [
    { id: 'github',    name: 'GitHub',     url: username => `https://github.com/${username}` },
    { id: 'youtube',   name: 'YouTube',    url: username => `https://www.youtube.com/@${username}` },
    { id: 'instagram', name: 'Instagram',  url: username => `https://www.instagram.com/${username}/` },
    { id: 'tiktok',    name: 'TikTok',     url: username => `https://www.tiktok.com/@${username}` },
    { id: 'x',         name: 'X / Twitter', url: username => `https://x.com/${username}` },
    { id: 'linkedin',  name: 'LinkedIn',   url: username => `https://www.linkedin.com/company/${username}` },
    { id: 'facebook',  name: 'Facebook',   url: username => `https://www.facebook.com/${username}` },
];

// Allowed TLDs (whitelist to prevent abuse)
const ALLOWED_TLDS = new Set([
    'de', 'com', 'eu', 'net', 'org', 'io', 'shop', 'online',
    'info', 'me', 'tech', 'blog', 'biz', 'app', 'dev', 'site',
]);

// ── Helpers ──────────────────────────────────────────────────────

async function checkDomain(domain) {
    try {
        await dns.resolveNs(domain);
        return 'taken';
    } catch (err) {
        if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return 'available';
        return 'unknown';
    }
}

async function checkSocialProfile(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const resp = await fetch(url, {
            method: 'HEAD',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AvailabilityChecker/1.0)',
            },
        });
        clearTimeout(timeout);
        if (resp.status === 404) return 'available';
        if (resp.status >= 200 && resp.status < 400) return 'taken';
        return 'unknown';
    } catch {
        clearTimeout(timeout);
        return 'unknown';
    }
}

// ── POST /api/availability/check ─────────────────────────────────
router.post('/check', [
    body('name')
        .isString().trim()
        .matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i)
        .withMessage('Name darf nur Buchstaben, Ziffern und Bindestriche enthalten (1-63 Zeichen).'),
    body('tlds')
        .isArray({ min: 1, max: 20 })
        .withMessage('Mindestens eine Domain-Endung auswählen.'),
    body('tlds.*')
        .isString().trim()
        .customSanitizer(v => v.replace(/^\./, ''))  // strip leading dot
        .custom(v => ALLOWED_TLDS.has(v))
        .withMessage('Ungültige Domain-Endung.'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, tlds } = req.body;
    const cleanName = name.trim().toLowerCase();

    try {
        // Domain checks — parallel
        const domainResults = await Promise.allSettled(
            tlds.map(async tld => {
                const domain = `${cleanName}.${tld.replace(/^\./, '')}`;
                const status = await checkDomain(domain);
                return { domain, tld, status };
            })
        );

        // Social media checks — parallel
        const socialResults = await Promise.allSettled(
            PLATFORMS.map(async platform => {
                const url = platform.url(cleanName);
                const status = await checkSocialProfile(url);
                return { id: platform.id, name: platform.name, url, status };
            })
        );

        // Trademark search links (static, no API)
        const trademarkLinks = [
            {
                name: 'DPMA Markenportal',
                description: 'Deutsches Patent- und Markenamt',
                url: `https://register.dpma.de/DPMAregister/marke/quickSearch?queryString=${encodeURIComponent(cleanName)}`,
            },
            {
                name: 'TMview (EU)',
                description: 'Europäische Markenrecherche (EUIPO)',
                url: `https://www.tmdn.org/tmview/#/tmview/results?page=1&pageSize=30&criteria=C&basicSearch=${encodeURIComponent(cleanName)}`,
            },
        ];

        res.json({
            name: cleanName,
            domains: domainResults.map(r => r.status === 'fulfilled' ? r.value : { domain: '?', tld: '?', status: 'unknown' }),
            social: socialResults.map(r => r.status === 'fulfilled' ? r.value : { id: '?', name: '?', url: '#', status: 'unknown' }),
            trademarks: trademarkLinks,
        });
    } catch (err) {
        logger.error('Availability check failed', err);
        res.status(500).json({ error: 'Verfügbarkeitsprüfung fehlgeschlagen.' });
    }
});

module.exports = router;
