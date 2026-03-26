'use strict';

const { CronJob } = require('cron');
const logger = require('../utils/logger');

const gesetze = require('./gesetze');

async function runScrapers() {
    logger.info('[cron] Running scrapers...');
    await gesetze.run();
}

function initScraperCron() {
    const cronExp = process.env.SCRAPER_CRON || '0 3 * * 1'; // Monday 03:00 by default
    const job = new CronJob(cronExp, runScrapers, null, true, 'Europe/Berlin');
    logger.info(`[cron] Scraper scheduled: ${cronExp}`);
    return job;
}

module.exports = { initScraperCron, runScrapers };
