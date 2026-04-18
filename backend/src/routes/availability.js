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

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

/**
 * Platform-specific social media checks.
 * Each platform responds differently to automated requests, so we need
 * tailored strategies rather than a one-size-fits-all HEAD request.
 */
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const resp = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timer);
        return resp;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

// GitHub & X/Twitter & LinkedIn: simple HEAD, 404 = available
async function checkByHead(url) {
    const resp = await fetchWithTimeout(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': BROWSER_UA },
    });
    if (resp.status === 404) return 'available';
    if (resp.status >= 200 && resp.status < 400) return 'taken';
    return 'unknown';
}

// YouTube: GET with consent-bypass cookie so EU servers don't get stuck on consent page
async function checkYouTube(url) {
    const resp = await fetchWithTimeout(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
            'User-Agent': BROWSER_UA,
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'CONSENT=PENDING+999; SOCS=CAESEwgDEgk2ODE4MTAyNTQaAmRlIAEaBgiA_LyaBg',
        },
    });
    if (resp.status === 404) return 'available';
    if (resp.status !== 200) return 'unknown';
    const body = await resp.text();
    // consent page or error page → can't determine
    if (body.includes('consent.youtube.com') || body.includes('consentpage')) return 'unknown';
    // real channel page has og:title or channelId
    if (body.includes('"channelId"') || body.includes('og:title')) return 'taken';
    return 'unknown';
}

// Instagram: public API endpoint — parse JSON body to confirm user exists
async function checkInstagram(username) {
    const resp = await fetchWithTimeout(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
        { headers: { 'User-Agent': BROWSER_UA, 'X-IG-App-ID': '936619743392459' } },
    );
    if (resp.status === 404) return 'available';
    if (resp.status !== 200) return 'unknown';
    // Parse body to verify user data is actually present
    try {
        const data = await resp.json();
        if (data && data.data && data.data.user) return 'taken';
        return 'available';
    } catch {
        return 'unknown';
    }
}

// TikTok: GET the profile page, parse embedded JSON statusCode
async function checkTikTok(url) {
    const resp = await fetchWithTimeout(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': BROWSER_UA },
    });
    if (resp.status === 404) return 'available';
    const body = await resp.text();
    // statusCode 10221 = user does not exist
    if (body.includes('"statusCode":10221')) return 'available';
    // Must match BOTH uniqueId containing the username AND statusCode 0
    if (body.includes('"statusCode":0')) {
        // Confirm there's actual user data, not just generic page content
        if (body.includes('"uniqueId"') && body.includes('"nickname"')) return 'taken';
    }
    return 'unknown';
}

// Facebook: GET the page, check for user-specific og:title (not generic error page)
async function checkFacebook(url) {
    const resp = await fetchWithTimeout(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
            'User-Agent': BROWSER_UA,
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });
    if (resp.status === 404) return 'available';
    if (resp.status !== 200) return 'unknown';
    const body = await resp.text();
    // Facebook error/login pages have generic titles or no og:title
    // A real profile page has a specific og:title with the page/user name
    const ogMatch = body.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i);
    if (ogMatch && ogMatch[1] && !ogMatch[1].toLowerCase().includes('facebook')) return 'taken';
    // Also check for profile-specific JSON-LD or entity data
    if (body.includes('"@type":"Person"') || body.includes('"@type":"Organization"')) return 'taken';
    return 'unknown';
}

// Dispatcher: route each platform to its checker
async function checkSocialProfile(platform, username) {
    try {
        switch (platform.id) {
            case 'youtube':   return await checkYouTube(platform.url(username));
            case 'instagram': return await checkInstagram(username);
            case 'tiktok':    return await checkTikTok(platform.url(username));
            case 'facebook':  return await checkFacebook(platform.url(username));
            default:          return await checkByHead(platform.url(username));
        }
    } catch {
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
                const status = await checkSocialProfile(platform, cleanName);
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
