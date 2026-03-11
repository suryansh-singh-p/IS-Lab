# AI Microservice (Cloud Mode Only)

FastAPI microservice designed for the **cloud mode** of the platform:

- Input is a **remote URL** (`videoUrl`) — no local uploads folder.
- The service **downloads** the video to a temporary file and runs:
  - transcription (pluggable backend; `whisper.cpp` supported)
  - evaluation (minimal baseline implementation included; pluggable for `llama.cpp` / GGUF models)
- Returns a single **evaluation JSON** suitable to store in Postgres.

## Endpoints

- `GET /health`
- `POST /v1/evaluate`

### `POST /v1/evaluate` request (example)

```json
{
  "sessionId": "optional-session-uuid",
  "sessionVideoId": "optional-video-uuid",
  "questionId": 1,
  "questionText": "Tell me about yourself",
  "videoUrl": "https://res.cloudinary.com/<cloud>/video/upload/...mp4"
}
```

### Response (shape)

```json
{
  "success": true,
  "data": {
    "transcript": { "text": "...", "language": "en" },
    "evaluation": {
      "overallScore": 7.5,
      "rationale": "...",
      "rubric": { "clarity": 7, "relevance": 8, "structure": 7, "examples": 6, "completeness": 8 }
    },
    "meta": { "durationSec": 123.4, "source": { "videoUrl": "..." } }
  }
}
```

## Running locally

```bash
cd ai-microservice
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Windows note (WhisperX)

If WhisperX returns an empty transcript and you see warnings about `torchcodec` / `FFmpeg`,
install FFmpeg and ensure `ffmpeg` is available on your `PATH`, then restart your terminal.

## Whisper.cpp (optional)

This service uses WhisperX for local transcription (recommended).

Environment variables:

- `TRANSCRIBER_BACKEND=whisperx` (default: `stub`)
- `WHISPERX_MODEL=medium.en` (optional)
- `WHISPERX_COMPUTE_TYPE=int8` (optional)

If not configured, it falls back to a stub transcriber (returns an empty transcript).

## Hugging Face Spaces (Docker)

This folder includes a `Dockerfile` suitable for HF Spaces (Docker SDK).
The image installs `ffmpeg`, which WhisperX/Pyannote need for audio decoding.

