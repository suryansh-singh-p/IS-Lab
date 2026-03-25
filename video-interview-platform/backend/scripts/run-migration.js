require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
}

function createPool(connectionString) {
    return new Pool({ connectionString });
}

const migrationPath = path.join(__dirname, '..', 'migrations', '20260204120000_create_initial_schema.sql');
let sql = fs.readFileSync(migrationPath, 'utf8');
sql = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');

// Split into two parts: before and including the trigger (which contains $$ and ;)
const triggerStart = sql.indexOf('CREATE OR REPLACE FUNCTION set_updated_at()');
const beforeTrigger = triggerStart > 0 ? sql.slice(0, triggerStart) : sql;
const triggerBlock = triggerStart > 0 ? sql.slice(triggerStart) : '';

const statements = beforeTrigger
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
if (triggerBlock.trim()) statements.push(triggerBlock.trim());

async function run() {
    const pool = createPool(databaseUrl);
    try {
        for (const statement of statements) {
            await pool.query(statement);
            const preview = statement.slice(0, 60).replace(/\s+/g, ' ');
            console.log('OK:', preview + (statement.length > 60 ? '...' : ''));
        }
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err && (err.message || err.toString()) ? (err.message || err.toString()) : err);
        if (err && err.stack) console.error(err.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
