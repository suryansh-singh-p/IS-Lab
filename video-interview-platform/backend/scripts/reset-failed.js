require('dotenv').config();
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function resetFailedVideos() {
    const result = await pool.query(
        "UPDATE session_videos SET evaluation_status='pending' WHERE evaluation_status='failed'"
    );
    console.log('Reset', result.rowCount, 'videos to pending');
    await pool.end();
}

resetFailedVideos().catch(console.error);
