const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const config = require('../config');

const WHISPER_TIMEOUT_MS = 120000; // 2 min for large uploads
const WHISPER_SCRIPT_TIMEOUT_MS = Number(process.env.WHISPER_SCRIPT_TIMEOUT_MS || 300000); // 5 min

/**
 * Transcribe audio/video to text.
 * Priority: OPENAI_API_KEY > Whisper Python script path > USE_WHISPER_NODE (whisper-node).
 * @param {string} filePath - Absolute path to video/audio file (e.g. .webm, .mp4, .wav)
 * @returns {Promise<{ text: string }>}
 */
async function transcribe(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('File not found for transcription: ' + filePath);
    }

    if (config.openaiApiKey) {
        console.log('[Transcription] Using OpenAI Whisper API');
        return transcribeWithOpenAIWhisper(filePath);
    }
    if (config.whisperScriptPath || config.whisperXScriptPath) {
        const scriptPath = config.whisperScriptPath || config.whisperXScriptPath;
        console.log('[Transcription] Using Whisper script:', scriptPath);
        try {
            return await transcribeWithWhisperScript(filePath, scriptPath);
        } catch (error) {
            const message = String(error?.message || '');
            const isWindows = process.platform === 'win32';

            if (config.openaiApiKey) {
                console.warn('[Transcription] Whisper script failed, falling back to OpenAI Whisper API:', message);
                return transcribeWithOpenAIWhisper(filePath);
            }

            if (config.useWhisperNode && !isWindows) {
                console.warn('[Transcription] Whisper script failed, falling back to whisper-node:', message);
                return transcribeWithWhisperNode(filePath);
            }

            if (config.useWhisperNode && isWindows) {
                console.warn('[Transcription] Whisper script failed. whisper-node fallback is disabled on Windows (requires make toolchain):', message);
            }

            throw error;
        }
    }
    if (config.useWhisperNode) {
        console.log('[Transcription] Using whisper-node (local)');
        return transcribeWithWhisperNode(filePath);
    }
    throw new Error('No transcription backend: set OPENAI_API_KEY, WHISPER_SCRIPT_PATH (or WHISPERX_SCRIPT_PATH), or USE_WHISPER_NODE=true (Linux/macOS recommended) in .env');
}

async function transcribeWithOpenAIWhisper(filePath) {
    const OpenAI = require('openai');
    const openai = new OpenAI({
        apiKey: config.openaiApiKey,
        timeout: WHISPER_TIMEOUT_MS
    });
    const basename = path.basename(filePath);
    const stat = await fs.promises.stat(filePath);
    console.log('[Transcription] Uploading to Whisper (' + (stat.size / 1024).toFixed(0) + ' KB)...');
    const stream = fs.createReadStream(filePath);
    stream.path = filePath;
    const response = await openai.audio.transcriptions.create({
        file: stream,
        model: 'whisper-1',
        response_format: 'json'
    });
    const text = (response && response.text) ? response.text : '';
    console.log('[Transcription] Whisper done, length:', text.length);
    return { text };
}

async function transcribeWithWhisperScript(filePath, scriptPath) {
    return new Promise((resolve, reject) => {
        if (!scriptPath || !fs.existsSync(scriptPath)) {
            reject(new Error('Whisper script path not found: ' + String(scriptPath || 'undefined')));
            return;
        }

        // Prefer venv (Windows dev), then system python3, then python
        const venvPython = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
        const pythonCmd = fs.existsSync(venvPython) ? venvPython
            : (fs.existsSync('/usr/bin/python3') ? 'python3' : 'python');
        
        console.log('[Transcription] Using Python:', pythonCmd);
        console.log('[Transcription] Script:', scriptPath);
        
        const py = spawn(pythonCmd, [scriptPath, filePath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const timer = setTimeout(() => {
            py.kill('SIGTERM');
            reject(new Error(`Whisper script timed out after ${Math.round(WHISPER_SCRIPT_TIMEOUT_MS / 1000)}s`));
        }, WHISPER_SCRIPT_TIMEOUT_MS);

        let stdout = '';
        let stderr = '';
        py.stdout.on('data', (d) => { stdout += d.toString(); });
        py.stderr.on('data', (d) => { stderr += d.toString(); });

        py.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        py.on('close', (code) => {
            clearTimeout(timer);

            const cleanedStdout = (stdout || '').trim();
            const cleanedStderr = (stderr || '').trim();

            if (code !== 0) {
                // The Python script prints JSON errors to stdout on failure.
                if (cleanedStdout) {
                    try {
                        const out = JSON.parse(cleanedStdout);
                        if (out?.error) {
                            reject(new Error('Whisper script failed: ' + out.error));
                            return;
                        }
                    } catch (_) {}
                }
                const detail = cleanedStderr || cleanedStdout || `exit code ${code}`;
                reject(new Error('Whisper script failed: ' + detail));
                return;
            }

            try {
                const out = JSON.parse(cleanedStdout);
                if (out?.error) {
                    reject(new Error('Whisper script failed: ' + out.error));
                    return;
                }
                const text = out.text || out.transcript || '';
                console.log('[Transcription] Whisper script done, length:', text.length);
                resolve({ text });
            } catch (e) {
                const detail = cleanedStdout.slice(0, 200) || cleanedStderr.slice(0, 200) || 'empty output';
                reject(new Error('Whisper script invalid JSON: ' + detail));
            }
        });
    });
}

/**
 * Convert audio/video to 16kHz WAV for whisper-node (requires ffmpeg).
 * @param {string} inputPath
 * @returns {Promise<string>} path to temp wav file (caller should unlink when done)
 */
async function convertToWav16k(inputPath) {
    const wavPath = path.join(os.tmpdir(), `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', wavPath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stderr = '';
        ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });
        ffmpeg.on('close', (code) => {
            if (code !== 0) reject(new Error('ffmpeg failed: ' + stderr.slice(-500)));
            else resolve();
        });
        ffmpeg.on('error', (err) => {
            if (err.code === 'ENOENT') {
                reject(new Error(
                    'ffmpeg not found. whisper-node needs ffmpeg to convert video/audio to WAV. ' +
                    'Install from https://ffmpeg.org/download.html (Windows: https://www.gyan.dev/ffmpeg/builds/) ' +
                    'and add the ffmpeg bin folder to your system PATH.'
                ));
            } else {
                reject(new Error('ffmpeg error: ' + err.message));
            }
        });
    });
    return wavPath;
}

async function transcribeWithWhisperNode(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let wavPath = filePath;
    let shouldUnlink = false;
    if (ext !== '.wav') {
        console.log('[Transcription] Converting to 16kHz WAV with ffmpeg...');
        wavPath = await convertToWav16k(filePath);
        shouldUnlink = true;
    }
    try {
        const whisper = (await import('whisper-node')).default;
        const options = {
            modelName: 'base.en',
            whisperOptions: {
                language: 'auto',
                gen_file_txt: false,
                gen_file_subtitle: false,
                gen_file_vtt: false,
                word_timestamps: false
            }
        };
        const transcript = await whisper(wavPath, options);
        const text = Array.isArray(transcript)
            ? transcript.map((s) => s.speech).filter(Boolean).join(' ')
            : (transcript && transcript.text) ? transcript.text : String(transcript || '');
        console.log('[Transcription] whisper-node done, length:', text.length);
        return { text };
    } finally {
        if (shouldUnlink && wavPath && fs.existsSync(wavPath)) {
            try { fs.unlinkSync(wavPath); } catch (_) {}
        }
    }
}

module.exports = { transcribe };
