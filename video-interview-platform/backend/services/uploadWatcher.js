const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const config = require('../config');
const db = require('../db');
const transcription = require('./transcription');
const evaluation = require('./evaluation');
const { analyzeEmotions } = require('./emotionAnalysis');
const { upsertSessionEvaluation } = require('./sessionEvaluationStore');

const VIDEO_EXTENSIONS = new Set(['.webm', '.mp4', '.mkv', '.mov']);

function isVideoFile(filePath) {
    return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function toDbRelativePath(filePath) {
    const relative = path.relative(config.uploadsDir, filePath);
    const normalized = path.join('uploads', relative).split(path.sep).join('/');
    return normalized;
}

function parseCandidateVideoMeta(filePath) {
    const filename = path.basename(filePath);
    const parentDir = path.dirname(filePath);
    const stem = path.basename(filePath, path.extname(filePath));

    let candidateName = path.basename(parentDir);
    let questionNum = 1;

    const qMatch = stem.match(/_Q(\d+)$/i);
    if (qMatch) {
        questionNum = parseInt(qMatch[1], 10);
        candidateName = stem.replace(/_Q\d+$/i, '');
    }

    return {
        filename,
        parentDir,
        stem,
        candidateName,
        questionNum,
        questionKey: `Q${questionNum}`
    };
}

function updateAnswersFile(parentDir, candidateName, questionNum, questionText, transcriptText, filename, filePath) {
    const answersFile = path.join(parentDir, `${candidateName}_answers.json`);
    let answersData = {
        candidate_name: candidateName,
        updated_at: new Date().toISOString(),
        answers: {}
    };

    if (fs.existsSync(answersFile)) {
        try {
            answersData = JSON.parse(fs.readFileSync(answersFile, 'utf-8'));
        } catch (e) {
            console.error('[FilePipeline] Failed to parse existing answers file:', e.message);
        }
    }

    answersData.answers = answersData.answers || {};
    answersData.answers[`Q${questionNum}`] = {
        question: questionText || '',
        transcript: transcriptText || '',
        filename: filename || null,
        file_path: filePath || null,
        answered_at: new Date().toISOString()
    };
    answersData.updated_at = new Date().toISOString();

    fs.writeFileSync(answersFile, JSON.stringify(answersData, null, 2), 'utf-8');
    console.log(`[FilePipeline] Updated: ${answersFile}`);
}

function gatherVideoFiles(rootDir) {
    const files = [];
    if (!fs.existsSync(rootDir)) return files;

    const stack = [rootDir];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (entry.isFile() && isVideoFile(fullPath)) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

function isAlreadyEvaluatedInFileMode(filePath) {
    const { parentDir, candidateName, questionKey } = parseCandidateVideoMeta(filePath);
    const evalFile = path.join(parentDir, `${candidateName}_evaluation.json`);
    if (!fs.existsSync(evalFile)) return false;
    try {
        const content = JSON.parse(fs.readFileSync(evalFile, 'utf-8'));
        return !!content?.evaluations?.[questionKey];
    } catch (e) {
        return false;
    }
}

/**
 * File-based pipeline for when DB is not configured.
 * Transcribes, evaluates, and saves JSON to candidate folder.
 */
async function runFilePipeline(filePath) {
    const { filename, parentDir, candidateName, questionNum } = parseCandidateVideoMeta(filePath);
    let questionText = '';

    // Load questions.json from candidate folder if exists
    const questionsFile = path.join(parentDir, 'questions.json');
    if (fs.existsSync(questionsFile)) {
        try {
            const qData = JSON.parse(fs.readFileSync(questionsFile, 'utf-8'));
            const questions = Array.isArray(qData) ? qData : (qData.questions || []);
            if (questions[questionNum - 1]) {
                const q = questions[questionNum - 1];
                questionText = typeof q === 'string' ? q : (q.text || '');
            }
        } catch (e) {
            console.error('[FilePipeline] Failed to load questions.json:', e.message);
        }
    }

    if (!questionText) {
        questionText = config.SEED_QUESTIONS[(questionNum - 1) % config.SEED_QUESTIONS.length] || 'Tell me about yourself';
    }

    console.log(`[FilePipeline] Processing: ${filename}`);
    console.log(`[FilePipeline] Candidate: ${candidateName}, Q${questionNum}`);

    // Transcribe + Emotion analysis in parallel
    console.log('[FilePipeline] Transcribing + Analyzing emotions...');
    const [transcriptResult, emotionResult] = await Promise.allSettled([
        transcription.transcribe(filePath),
        analyzeEmotions(filePath)
    ]);

    const { text: transcriptText } = transcriptResult.status === 'fulfilled' ? transcriptResult.value : { text: '' };
    if (transcriptResult.status === 'rejected') {
        console.error('[FilePipeline] Transcription failed:', transcriptResult.reason?.message);
    }
    if (!transcriptText || !transcriptText.trim()) {
        console.error('[FilePipeline] Empty transcript');
        return;
    }
    console.log(`[FilePipeline] Transcript: ${transcriptText.length} chars`);

    updateAnswersFile(parentDir, candidateName, questionNum, questionText, transcriptText, filename, filePath);

    let emotionData = null;
    if (emotionResult.status === 'fulfilled' && emotionResult.value) {
        emotionData = emotionResult.value;
        console.log(`[FilePipeline] Emotion analysis done — longest emotion: ${emotionData.summary?.longest_emotion?.emotion} (${emotionData.summary?.longest_emotion?.duration_sec}s)`);
    } else if (emotionResult.status === 'rejected') {
        console.error('[FilePipeline] Emotion analysis failed:', emotionResult.reason?.message);
    }

    // Build QA JSON
    const qaJson = { question: questionText, answer: transcriptText };

    // Evaluate
    console.log('[FilePipeline] Evaluating...');
    const { answer_text, score, expected_expression, evaluation_json } = await evaluation.evaluateAnswer(
        questionText,
        transcriptText,
        qaJson
    );
    console.log(`[FilePipeline] Score: ${score}/10`);

    // Update or create evaluation JSON in candidate folder
    const evalFile = path.join(parentDir, `${candidateName}_evaluation.json`);
    let evalData = {
        candidate_name: candidateName,
        updated_at: new Date().toISOString(),
        evaluations: {},
        summary: { total_videos: 0, average_score: 0, scores: [] }
    };

    if (fs.existsSync(evalFile)) {
        try {
            evalData = JSON.parse(fs.readFileSync(evalFile, 'utf-8'));
        } catch (e) {
            console.error('[FilePipeline] Failed to parse existing eval file:', e.message);
        }
    }

    evalData.evaluations = evalData.evaluations || {};
    evalData.evaluations[`Q${questionNum}`] = {
        question: questionText,
        transcript: transcriptText,
        answer_summary: answer_text,
        expected_expression,
        evaluation: evaluation_json,
        score,
        filename,
        emotion_analysis: emotionData ? {
            emotions_timeline: emotionData.emotions_timeline,
            summary: emotionData.summary
        } : null,
        evaluated_at: new Date().toISOString()
    };

    // Recompute summary
    const scores = [];
    for (const key of Object.keys(evalData.evaluations)) {
        const s = Number(evalData.evaluations[key]?.score);
        if (!Number.isNaN(s)) scores.push(s);
    }
    evalData.summary = {
        total_videos: scores.length,
        average_score: scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0,
        scores
    };
    evalData.updated_at = new Date().toISOString();

    fs.writeFileSync(evalFile, JSON.stringify(evalData, null, 2), 'utf-8');
    console.log(`[FilePipeline] Saved: ${evalFile}`);
}

async function scanAndProcessUnprocessedFiles() {
    if (db.pool) {
        console.log('[UploadsWatcher] DB mode enabled — skipping file-mode startup scan');
        return;
    }

    const videoFiles = gatherVideoFiles(config.uploadsDir);
    if (videoFiles.length === 0) {
        console.log('[UploadsWatcher] Startup scan: no video files found');
        return;
    }

    console.log(`[UploadsWatcher] Startup scan found ${videoFiles.length} video file(s)`);

    for (const filePath of videoFiles) {
        if (isAlreadyEvaluatedInFileMode(filePath)) {
            continue;
        }
        try {
            await runFilePipeline(filePath);
        } catch (err) {
            console.error('[UploadsWatcher] Startup processing failed:', err.message);
        }
    }
}

function startUploadsWatcher() {
    if (!config.uploadWatcherEnabled) {
        console.log('[UploadsWatcher] Disabled by config (UPLOAD_WATCHER=false)');
        return null;
    }

    const useDbMode = !!db.pool;
    if (!useDbMode) {
        console.log('[UploadsWatcher] No database — using file-based pipeline');
    }

    const processing = new Set();

    const watcher = chokidar.watch(config.uploadsDir, {
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 200
        }
    });

    watcher.on('add', async (filePath) => {
        try {
            if (!isVideoFile(filePath)) return;
            if (processing.has(filePath)) return;
            processing.add(filePath);

            if (useDbMode) {
                // DB mode: look up record and trigger pipeline
                const { triggerPipeline } = require('./videoEvaluationPipeline');
                const relativePath = toDbRelativePath(filePath);
                const row = await db.getSessionVideoByFilePath(relativePath);
                if (!row) {
                    console.log('[UploadsWatcher] No DB record for:', relativePath);
                    return;
                }
                if (row.evaluation_status !== 'pending') {
                    console.log('[UploadsWatcher] Skipping (status:', row.evaluation_status + ')', relativePath);
                    return;
                }

                triggerPipeline(
                    row.id,
                    filePath,
                    row.question_text || '',
                    row.session_id,
                    row.question_id,
                    row.filename
                );
            } else {
                // File-based mode: process directly
                console.log('[UploadsWatcher] New video detected:', filePath);
                await runFilePipeline(filePath);
            }
        } catch (err) {
            console.error('[UploadsWatcher] Error:', err.message);
        } finally {
            processing.delete(filePath);
        }
    });

    watcher.on('error', (err) => {
        console.error('[UploadsWatcher] Watcher error:', err.message);
    });

    console.log('[UploadsWatcher] Watching:', config.uploadsDir);
    return watcher;
}

module.exports = { startUploadsWatcher, runFilePipeline, scanAndProcessUnprocessedFiles };
