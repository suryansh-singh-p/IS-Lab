const path = require('path');
const fs = require('fs');

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
    whisperXScriptPath: process.env.WHISPERX_SCRIPT_PATH || path.resolve(__dirname, '..', 'scripts', 'whisper_transcribe.py'),
    useWhisperNode: process.env.USE_WHISPER_NODE === 'true',
    deepfaceScriptPath: process.env.DEEPFACE_SCRIPT_PATH || path.join(__dirname, '..', 'scripts', 'deepface_analyze.py'),
    uploadsDir,
    evaluationsDir,
    uploadWatcherEnabled: process.env.UPLOAD_WATCHER !== 'false',
    SEED_QUESTIONS,
    // LLM provider config — set LLM_PROVIDER=ollama for local, openrouter/openai for cloud
    llmProvider: process.env.LLM_PROVIDER || 'ollama',
    llmBaseUrl: process.env.LLM_BASE_URL || 'http://ollama:11434/v1',
    llmModel: process.env.LLM_MODEL || 'llama3.2:3b',
    llmApiKey: process.env.LLM_API_KEY || 'ollama',
    cors: {
        origin: ['http://localhost:5173', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }
};
