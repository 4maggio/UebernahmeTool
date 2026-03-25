'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const fs   = require('fs');
const path = require('path');
const db   = require('./index');

async function migrate() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} migration(s)...`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const { rows } = await db.query(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (rows.length > 0) {
      console.log(`  [skip] ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.query(sql);
    await db.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [file]
    );
    console.log(`  [done] ${file}`);
  }

  console.log('Migrations complete.');
  await db.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
