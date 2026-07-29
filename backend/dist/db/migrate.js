import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, pool, withTransaction } from './index.js';
/**
 * Baseline + ordered migrations.
 *
 * `schema.sql` is the frozen baseline (version `000_baseline`). It is not
 * edited for new changes — every subsequent change is a numbered file in
 * `migrations/`, applied once and recorded in `schema_migrations`.
 *
 * Each migration runs in its own transaction: a failure rolls that file back
 * and stops the run, leaving earlier migrations applied and recorded.
 */
const BASELINE_VERSION = '000_baseline';
async function ensureMigrationsTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}
async function appliedVersions() {
    const { rows } = await pool.query('SELECT version FROM schema_migrations');
    return new Set(rows.map((r) => r.version));
}
async function apply(version, sql) {
    await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)
       ON CONFLICT (version) DO NOTHING`, [version]);
    });
    console.log(`[migrate] applied ${version}`);
}
async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await ensureMigrationsTable();
    const already = await appliedVersions();
    // Baseline. Idempotent, so re-applying an unrecorded baseline over an
    // existing database is safe.
    if (!already.has(BASELINE_VERSION)) {
        const sql = await readFile(join(here, 'schema.sql'), 'utf8');
        await apply(BASELINE_VERSION, sql);
    }
    else {
        console.log(`[migrate] skip ${BASELINE_VERSION}`);
    }
    const dir = join(here, 'migrations');
    const files = (await readdir(dir).catch(() => []))
        .filter((f) => f.endsWith('.sql'))
        .sort();
    for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (already.has(version)) {
            console.log(`[migrate] skip ${version}`);
            continue;
        }
        await apply(version, await readFile(join(dir, file), 'utf8'));
    }
    console.log('[migrate] done');
}
main()
    .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
})
    .finally(closePool);
//# sourceMappingURL=migrate.js.map