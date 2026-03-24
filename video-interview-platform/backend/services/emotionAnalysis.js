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
            // Parse stdout robustly: DeepFace/tensorflow/opencv can emit noise around JSON.
            const trimmed = stdout.trim();
            let parsed = null;
            if (trimmed) {
                try {
                    parsed = JSON.parse(trimmed);
                } catch (_) {
                    // Try extracting a JSON object from mixed output.
                    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            parsed = JSON.parse(jsonMatch[0]);
                        } catch (_) {
                            parsed = null;
                        }
                    }
                }
            }

            if (parsed) {
                if (parsed.error) {
                    reject(new Error('DeepFace error: ' + parsed.error));
                    return;
                }
                console.log('[EmotionAnalysis] Done — analyzed', parsed.analyzed_frames, 'frames,', parsed.faces_detected, 'faces detected');
                resolve(parsed);
                return;
            }

            if (code !== 0) {
                reject(new Error('DeepFace script failed (exit ' + code + '): ' + (stderr || stdout).slice(0, 500)));
                return;
            }

            // Exit code is 0 but parse still failed — provide actionable diagnostics.
            const stdoutHead = trimmed.slice(0, 300);
            const stderrTail = (stderr || '').slice(-300);
            reject(new Error(
                'DeepFace produced non-JSON output. ' +
                'stdout_head="' + stdoutHead + '" ' +
                'stderr_tail="' + stderrTail + '"'
            ));
        });

        py.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

module.exports = { analyzeEmotions };
