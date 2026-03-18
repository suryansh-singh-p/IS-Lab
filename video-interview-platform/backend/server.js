require('dotenv').config();

const app = require('./app');
const config = require('./config');
const { startUploadsWatcher } = require('./services/uploadWatcher');
const { bootstrapEvaluationOnStartup } = require('./services/evaluationStartup');

const PORT = config.port;

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║       Video Interview Platform - Backend Server              ║
╠══════════════════════════════════════════════════════════════╣
║  Server running on:    http://localhost:${PORT}                  ║
║  Create session:       POST /sessions                        ║
║  Upload endpoint:      POST /upload                         ║
║  Generate questions:   POST /generate-questions             ║
║  Health check:         GET /health                          ║
║  Uploads folder:       ./uploads                            ║
║  Database:             ${config.databaseUrl ? 'Postgres (DATABASE_URL)' : 'not configured'}             ║
╚══════════════════════════════════════════════════════════════╝
    `);

    startUploadsWatcher();
    bootstrapEvaluationOnStartup().catch((err) => {
        console.error('[StartupEval] Unhandled startup evaluation error:', err.message);
    });
});
