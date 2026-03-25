require('dotenv').config();
const path = require('path');
const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
const config = require('../config');
const { runPipeline } = require('../services/videoEvaluationPipeline');

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function processPendingVideos() {
    const result = await pool.query(
        "SELECT id, session_id, question_id, question_text, filename, file_path FROM session_videos WHERE evaluation_status='pending'"
    );
    
    console.log('Found', result.rows.length, 'pending videos');
    
    for (const row of result.rows) {
        const absolutePath = path.join(config.uploadsDir, '..', row.file_path);
        console.log('\nProcessing:', row.filename);
        console.log('  Path:', absolutePath);
        
        try {
            await runPipeline(
                row.id,
                absolutePath,
                row.question_text || '',
                row.session_id,
                row.question_id,
                row.filename
            );
            console.log('  ✅ Done');
        } catch (err) {
            console.error('  ❌ Error:', err.message);
        }
    }
    
    await pool.end();
    console.log('\nAll done!');
}

processPendingVideos().catch(console.error);
