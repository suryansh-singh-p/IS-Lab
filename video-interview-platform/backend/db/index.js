const { Pool } = require('pg');
const config = require('../config');

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

let pool = null;
if (config.databaseUrl) {
    pool = createPool(config.databaseUrl);
    pool.on('error', (err) => console.error('Postgres pool error:', err));
    console.log('PostgreSQL: connected (DATABASE_URL from env)');

    // Ensure newer columns exist even if migrations weren't run.
    // This is idempotent (IF NOT EXISTS) and prevents runtime crashes in the pipeline.
    (async () => {
        try {
            await pool.query(
                `ALTER TABLE session_videos
                    ADD COLUMN IF NOT EXISTS transcript_text TEXT,
                    ADD COLUMN IF NOT EXISTS answer_text TEXT,
                    ADD COLUMN IF NOT EXISTS expected_expression TEXT,
                    ADD COLUMN IF NOT EXISTS evaluation_json JSONB,
                    ADD COLUMN IF NOT EXISTS score NUMERIC(4,2),
                    ADD COLUMN IF NOT EXISTS evaluation_status VARCHAR(20) NOT NULL DEFAULT 'pending'`
            );
        } catch (err) {
            console.error('PostgreSQL: failed ensuring evaluation columns:', err.message);
        }
    })();
} else {
    console.log('PostgreSQL: DATABASE_URL not set, uploads will not be saved to DB');
}

async function getUserByEmail(email) {
    if (!pool) return null;
    const result = await pool.query(
        'SELECT id, email, password_hash, role FROM users WHERE email = $1',
        [email]
    );
    return result.rows[0] || null;
}

async function createUser(email, passwordHash, role = 'user') {
    if (!pool) return null;
    const result = await pool.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
        [email, passwordHash, role]
    );
    return result.rows[0] || null;
}

async function getOrCreateGuestUserId() {
    if (!pool) return null;
    const guestEmail = 'guest@video-interview.local';
    let row = (await pool.query('SELECT id FROM users WHERE email = $1', [guestEmail])).rows[0];
    if (row) return row.id;
    const insert = await pool.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, \'user\') RETURNING id',
        [guestEmail, '']
    );
    return insert.rows[0].id;
}

async function createSession(candidateName = null, userId = null) {
    if (!pool) return null;
    const uid = userId || (await getOrCreateGuestUserId());
    if (!uid) return null;
    const result = await pool.query(
        'INSERT INTO interview_sessions (user_id, candidate_name) VALUES ($1, $2) RETURNING id',
        [uid, candidateName || null]
    );
    return result.rows[0].id;
}

async function insertSessionVideo(sessionId, questionId, questionText, filename, filePath, fileSizeBytes) {
    if (!pool) return null;
    const result = await pool.query(
        `INSERT INTO session_videos (session_id, question_id, question_text, filename, file_path, file_size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [sessionId, questionId ?? 0, questionText || null, filename, filePath, fileSizeBytes ?? null]
    );
    return result.rows[0].id;
}

async function setVideoEvaluationStatus(sessionVideoId, status) {
    if (!pool) return;
    await pool.query(
        'UPDATE session_videos SET evaluation_status = $1 WHERE id = $2',
        [status, sessionVideoId]
    );
}

async function updateSessionVideoEvaluation(sessionVideoId, transcriptText, answerText, expectedExpression, evaluationJson, score) {
    if (!pool) return;
    await pool.query(
        `UPDATE session_videos SET
         transcript_text = $1, answer_text = $2, expected_expression = $3, evaluation_json = $4, score = $5, evaluation_status = 'completed'
         WHERE id = $6`,
        [transcriptText || null, answerText || null, expectedExpression || null, evaluationJson ? JSON.stringify(evaluationJson) : null, score ?? null, sessionVideoId]
    );
}

async function getSessionVideoById(sessionVideoId) {
    if (!pool) return null;
    const result = await pool.query(
        `SELECT id, session_id, question_id, question_text, filename, file_path, evaluation_status
         FROM session_videos WHERE id = $1`,
        [sessionVideoId]
    );
    return result.rows[0] || null;
}

async function getSessionVideoByFilePath(filePath) {
    if (!pool) return null;
    const result = await pool.query(
        `SELECT id, session_id, question_id, question_text, filename, file_path, evaluation_status
         FROM session_videos WHERE file_path = $1`,
        [filePath]
    );
    return result.rows[0] || null;
}

async function claimVideoForProcessing(sessionVideoId) {
    if (!pool) return false;
    const result = await pool.query(
        `UPDATE session_videos
         SET evaluation_status = 'processing'
         WHERE id = $1 AND evaluation_status = 'pending'`,
        [sessionVideoId]
    );
    return result.rowCount > 0;
}

async function getAllSessionsWithVideos() {
    if (!pool) return [];
    const sessionsResult = await pool.query(
        `SELECT s.id, s.candidate_name, s.status, s.created_at, s.updated_at, u.email as user_email
         FROM interview_sessions s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.created_at DESC`
    );
    const sessions = sessionsResult.rows;
    for (const session of sessions) {
        const videosResult = await pool.query(
            `SELECT id, question_id, question_text, filename, file_path, evaluation_status, score, transcript_text, answer_text, evaluation_json
             FROM session_videos WHERE session_id = $1 ORDER BY question_id`,
            [session.id]
        );
        session.videos = videosResult.rows;
    }
    return sessions;
}

module.exports = {
    get pool() { return pool; },
    getUserByEmail,
    createUser,
    getOrCreateGuestUserId,
    createSession,
    insertSessionVideo,
    setVideoEvaluationStatus,
    updateSessionVideoEvaluation,
    getSessionVideoById,
    getSessionVideoByFilePath,
    claimVideoForProcessing,
    getAllSessionsWithVideos
};
