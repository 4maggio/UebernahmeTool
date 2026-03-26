'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('Unexpected DB pool error:', err);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    end: () => pool.end(),
    pool,
};
