'use strict';

/**
 * removeBudXXL.js — Remove the BudXXL user from the database
 *
 * Usage:  node src/scripts/removeBudXXL.js
 *
 * - Sets contract_drafts.created_by = NULL for rows owned by BudXXL (FK ON DELETE SET NULL)
 * - Deletes the user row from the users table
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const db = require('../db');

async function removeBudXXL() {
    const username = 'BudXXL';

    // Find user
    const { rows } = await db.query(
        'SELECT id, username, role FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
    );

    if (!rows.length) {
        console.log(`User "${username}" not found — nothing to do.`);
        await db.end();
        return;
    }

    const user = rows[0];
    console.log(`Found user: id=${user.id}, username=${user.username}, role=${user.role}`);

    // Nullify contract_drafts references (FK already uses ON DELETE SET NULL, but let's be explicit)
    const updateResult = await db.query(
        'UPDATE contract_drafts SET created_by = NULL WHERE created_by = $1',
        [user.id]
    );
    console.log(`  → Unlinked ${updateResult.rowCount} contract draft(s) from ${username}`);

    // Delete user
    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    console.log(`  → User "${username}" deleted.`);

    await db.end();
    console.log('Done.');
}

removeBudXXL().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
