const path = require('path');
const db = require('../db');
const config = require('../config');
const { runPipeline } = require('./videoEvaluationPipeline');
const { scanAndProcessUnprocessedFiles } = require('./uploadWatcher');

async function processPendingDbVideosOnStartup() {
    if (!db.pool) return;

    try {
        const result = await db.pool.query(
            "SELECT id, session_id, question_id, question_text, filename, file_path FROM session_videos WHERE evaluation_status='pending'"
        );

        if (!result.rows.length) {
            console.log('[StartupEval] No pending DB videos');
            return;
        }

        console.log(`[StartupEval] Found ${result.rows.length} pending DB video(s)`);

        for (const row of result.rows) {
            const absolutePath = path.resolve(config.uploadsDir, '..', row.file_path);
            try {
                await runPipeline(
                    row.id,
                    absolutePath,
                    row.question_text || '',
                    row.session_id,
                    row.question_id,
                    row.filename
                );
            } catch (err) {
                console.error('[StartupEval] Failed for', row.filename, '-', err.message);
            }
        }
    } catch (err) {
        console.error('[StartupEval] DB startup processing error:', err.message);
    }
}

async function bootstrapEvaluationOnStartup() {
    if (!config.processPendingOnStartup) {
        console.log('[StartupEval] Disabled by config (PROCESS_PENDING_ON_STARTUP=false)');
        return;
    }

    if (db.pool) {
        await processPendingDbVideosOnStartup();
    } else {
        await scanAndProcessUnprocessedFiles();
    }
}

module.exports = { bootstrapEvaluationOnStartup };
