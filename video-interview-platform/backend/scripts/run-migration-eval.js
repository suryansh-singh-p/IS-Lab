require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
}

function createPool(connectionString) {
    const needsSsl =
        process.env.DATABASE_USE_SSL === 'true' ||
        process.env.PGSSLMODE === 'require' ||
        (connectionString && connectionString.includes('neon.tech'));

    return new Pool({
        connectionString,
        ssl: needsSsl ? { rejectUnauthorized: false } : undefined
    });
}

const migrationPath = path.join(__dirname, '..', 'migrations', '20260205000000_add_video_evaluation.sql');
const sql = fs.readFileSync(migrationPath, 'utf8')
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

const statements = sql.split(';').map(s => s.trim()).filter(Boolean);

async function run() {
    const pool = createPool(databaseUrl);
    try {
        for (const statement of statements) {
            await pool.query(statement);
            console.log('OK:', statement.slice(0, 60).replace(/\s+/g, ' ') + '...');
        }
        console.log('Evaluation migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err && (err.message || err.toString()) ? (err.message || err.toString()) : err);
        if (err && err.stack) console.error(err.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
