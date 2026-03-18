const path = require('path');
const fs = require('fs');

function parseBoolean(value, defaultValue = false) {
    if (value == null) return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
}

function resolveExistingFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;
    const normalized = path.normalize(filePath.trim());
    return fs.existsSync(normalized) ? normalized : null;
}

function resolveScriptPath({ primaryEnv, secondaryEnv, fallbackPath, label }) {
    const fromPrimary = resolveExistingFile(primaryEnv);
    if (fromPrimary) return fromPrimary;

    const fromSecondary = resolveExistingFile(secondaryEnv);
    if (fromSecondary) return fromSecondary;

    if ((primaryEnv && !fromPrimary) || (secondaryEnv && !fromSecondary)) {
        console.warn(`[Config] ${label} env path not found. Falling back to bundled script.`);
    }

    const fallback = resolveExistingFile(fallbackPath);
    if (fallback) return fallback;

    console.warn(`[Config] ${label} script not found at fallback path: ${fallbackPath}`);
    return null;
}

function parseCorsOrigins(value) {
    if (!value || typeof value !== 'string') return [];
    return value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

const envCorsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN || process.env.CORS_ORIGINS);
const defaultCorsOrigins = ['http://localhost:5173', 'http://localhost:3000'];
const allowedCorsOrigins = envCorsOrigins.length > 0 ? envCorsOrigins : defaultCorsOrigins;

const localWhisperScript = path.resolve(__dirname, '..', 'scripts', 'whisper_transcribe.py');
const localDeepfaceScript = path.resolve(__dirname, '..', 'scripts', 'deepface_analyze.py');

const whisperScriptPath = resolveScriptPath({
    primaryEnv: process.env.WHISPER_SCRIPT_PATH,
    secondaryEnv: process.env.WHISPERX_SCRIPT_PATH,
    fallbackPath: localWhisperScript,
    label: 'Whisper'
});

const emotionAnalysisEnabled = parseBoolean(process.env.EMOTION_ANALYSIS_ENABLED, true);
const deepfaceScriptPath = emotionAnalysisEnabled
    ? resolveScriptPath({
        primaryEnv: process.env.DEEPFACE_SCRIPT_PATH,
        secondaryEnv: null,
        fallbackPath: localDeepfaceScript,
        label: 'DeepFace'
    })
    : null;

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
const evaluationsDir = path.join(uploadsDir, 'evaluations');
if (!fs.existsSync(evaluationsDir)) {
    fs.mkdirSync(evaluationsDir, { recursive: true });
}

const SEED_QUESTIONS = [
    "Tell me a little about yourself and what motivates you to wake up in the morning.",
    "Tell me about a time you made a significant mistake at work. How did you handle it?",
    "Describe a situation where you had to deal with a difficult coworker or client.",
    "Have you ever been assigned a task you felt was impossible? What did you do?",
    "If we asked your previous manager to describe you in three words, what would they be and why?",
    "Describe your ideal work environment.",
    "Tell me about a time you had to deliver bad news to a stakeholder.",
    "What is the one professional achievement you are most proud of?",
    "Tell me about a time you had to learn a completely new tool or skill very quickly.",
    "Is there anything about this job description that makes you nervous?"
];

module.exports = {
    port: process.env.PORT || 5000,
    databaseUrl: process.env.DATABASE_URL || null,
    jwtSecret: process.env.JWT_SECRET || 'video-interview-secret-change-in-production',
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY || null,
    whisperScriptPath,
    whisperXScriptPath: whisperScriptPath,
    useWhisperNode: process.env.USE_WHISPER_NODE === 'true',
    emotionAnalysisEnabled,
    deepfaceScriptPath,
    uploadsDir,
    evaluationsDir,
    uploadWatcherEnabled: process.env.UPLOAD_WATCHER !== 'false',
    processPendingOnStartup: process.env.PROCESS_PENDING_ON_STARTUP !== 'false',
    SEED_QUESTIONS,
    cors: {
        origin: allowedCorsOrigins,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }
};
