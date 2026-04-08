'use strict';

/**
 * seedUsers.js — Create initial users (FredXXL, baeste)
 *
 * Usage:  node src/db/seeds/seedUsers.js
 *
 * Passwords are read from env vars or use generated defaults.
 * Defaults are printed to console on first run.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const bcrypt = require('bcrypt');
const db = require('../index');

const SALT_ROUNDS = 12;

const USERS = [
    {
        username: 'FredXXL',
        role: 'manager',
        envPassword: 'SEED_PW_FREDXXL',
        defaultPassword: 'FredXXL_Start2026!',
    },
    {
        username: 'baeste',
        role: 'admin',
        envPassword: 'SEED_PW_BAESTE',
        defaultPassword: 'Baeste_Admin2026!',
    },
];

async function seedUsers() {
    console.log('Seeding users...\n');

    for (const u of USERS) {
        // Check if already exists
        const { rows } = await db.query(
            'SELECT id FROM users WHERE username = $1',
            [u.username]
        );
        if (rows.length > 0) {
            console.log(`  [skip] ${u.username} (already exists, id=${rows[0].id})`);
            continue;
        }

        const password = process.env[u.envPassword] || u.defaultPassword;
        const hash = await bcrypt.hash(password, SALT_ROUNDS);

        const result = await db.query(
            `INSERT INTO users (username, password_hash, role, is_active)
             VALUES ($1, $2, $3, TRUE)
             RETURNING id, username, role`,
            [u.username, hash, u.role]
        );

        const created = result.rows[0];
        console.log(`  [created] ${created.username} (id=${created.id}, role=${created.role})`);

        // Show password if using default (only on first seed)
        if (!process.env[u.envPassword]) {
            console.log(`           Initial password: ${u.defaultPassword}`);
        }
    }

    console.log('\nUser seeding complete.');
    console.log('⚠️  Share passwords securely. Users cannot reset their own passwords.');
    await db.end();
}

seedUsers().catch(err => {
    console.error('User seeding failed:', err);
    process.exit(1);
});
