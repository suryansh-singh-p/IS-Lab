const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const DEEPFACE_TIMEOUT_MS = 180000; // 3 min for large videos

/**
 * Analyze emotions in a video file using DeepFace (Python subprocess).
 * Mirrors the transcription.js pattern exactly.
 * @param {string} filePath - Absolute path to video file
 * @returns {Promise<object>} - Emotion analysis JSON
 */
async function analyzeEmotions(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('File not found for emotion analysis: ' + filePath);
    }

    const scriptPath = config.deepfaceScriptPath;
    if (!scriptPath) {
        console.log('[EmotionAnalysis] DEEPFACE_SCRIPT_PATH not set, skipping');
        return null;
    }

    return runDeepFaceScript(filePath, scriptPath);
}

/**
 * Spawn Python subprocess to run deepface_analyze.py.
 */
function runDeepFaceScript(filePath, scriptPath) {
    return new Promise((resolve, reject) => {
        // Use the venv Python if available (same logic as transcription.js)
        const venvPython = path.resolve(__dirname, '..', 'venv', 'Scripts', 'python.exe');
        const ispVenv = path.resolve(__dirname, '..', '..', '..', 'isp', 'Scripts', 'python.exe');
        let pythonCmd = fs.existsSync('/usr/bin/python3') ? 'python3' : 'python';

        if (fs.existsSync(venvPython)) {
            pythonCmd = venvPython;
        } else if (fs.existsSync(ispVenv)) {
            pythonCmd = ispVenv;
        }

        console.log('[EmotionAnalysis] Using Python:', pythonCmd);
        console.log('[EmotionAnalysis] Script:', scriptPath);
        console.log('[EmotionAnalysis] Video:', filePath);

        const py = spawn(pythonCmd, [scriptPath, filePath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        py.stdout.on('data', (d) => { stdout += d.toString(); });
        py.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
            py.kill();
            reject(new Error('DeepFace analysis timed out after ' + (DEEPFACE_TIMEOUT_MS / 1000) + 's'));
        }, DEEPFACE_TIMEOUT_MS);

        py.on('close', (code) => {
            clearTimeout(timer);
            // Try parsing stdout first — TensorFlow prints warnings to stderr
            // which can cause non-zero exit codes in some shells even on success
            const trimmed = stdout.trim();
            if (trimmed) {
                try {
                    const result = JSON.parse(trimmed);
                    if (result.error) {
                        reject(new Error('DeepFace error: ' + result.error));
                        return;
                    }
                    console.log('[EmotionAnalysis] Done — analyzed', result.analyzed_frames, 'frames,', result.faces_detected, 'faces detected');
                    resolve(result);
                    return;
                } catch (e) {
                    // Not valid JSON, fall through to error handling
                }
            }
            if (code !== 0) {
                reject(new Error('DeepFace script failed (exit ' + code + '): ' + (stderr || stdout).slice(0, 500)));
                return;
            }
            reject(new Error('DeepFace produced no output'));
        });

        py.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

module.exports = { analyzeEmotions };
