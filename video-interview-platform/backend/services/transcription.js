const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const config = require('../config');

const WHISPER_TIMEOUT_MS = 120000; // 2 min for large uploads

/**
 * Transcribe audio/video to text.
 * Priority: OPENAI_API_KEY > WHISPERX_SCRIPT_PATH > USE_WHISPER_NODE (whisper-node).
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
    if (config.whisperXScriptPath) {
        console.log('[Transcription] Using WhisperX script:', config.whisperXScriptPath);
        return transcribeWithWhisperX(filePath);
    }
    if (config.useWhisperNode) {
        console.log('[Transcription] Using whisper-node (local)');
        return transcribeWithWhisperNode(filePath);
    }
    throw new Error('No transcription backend: set OPENAI_API_KEY, WHISPERX_SCRIPT_PATH, or USE_WHISPER_NODE=true in .env');
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

async function transcribeWithWhisperX(filePath) {
    return new Promise((resolve, reject) => {
        // Prefer venv (Windows dev), then system python3, then python
        const venvPython = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
        const pythonCmd = fs.existsSync(venvPython) ? venvPython
            : (fs.existsSync('/usr/bin/python3') ? 'python3' : 'python');
        
        console.log('[Transcription] Using Python:', pythonCmd);
        console.log('[Transcription] Script:', config.whisperXScriptPath);
        
        const py = spawn(pythonCmd, [config.whisperXScriptPath, filePath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        py.stdout.on('data', (d) => { stdout += d.toString(); });
        py.stderr.on('data', (d) => { stderr += d.toString(); });
        py.on('close', (code) => {
            if (code !== 0) {
                reject(new Error('WhisperX script failed: ' + (stderr || stdout)));
                return;
            }
            try {
                const out = JSON.parse(stdout.trim());
                const text = out.text || out.transcript || '';
                console.log('[Transcription] WhisperX done, length:', text.length);
                resolve({ text });
            } catch (e) {
                reject(new Error('WhisperX invalid JSON: ' + stdout.slice(0, 200)));
            }
        });
        py.on('error', (err) => reject(err));
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
