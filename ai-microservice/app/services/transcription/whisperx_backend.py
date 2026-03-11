import time

import torch
import whisperx

from app.services.transcription.base import Transcriber, TranscriptionResult
from app.core.settings import Settings


class WhisperXTranscriber(Transcriber):
    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None
        self._device = "cuda" if torch.cuda.is_available() else "cpu"

    def _ensure_model(self):
        if self._model is not None:
            return self._model

        model_name = self._settings.whisperx_model
        compute_type = self._settings.whisperx_compute_type

        print(f"[WhisperX] Loading model '{model_name}' on device '{self._device}' (compute_type={compute_type})")

        # Download/load whisperx model (stored in HF cache between runs)
        self._model = whisperx.load_model(
            model_name,
            device=self._device,
            compute_type=compute_type,
        )
        print("[WhisperX] Model loaded.")
        return self._model

    def transcribe(self, file_path: str) -> TranscriptionResult:
        print(f"[WhisperX] Starting transcription for: {file_path}")
        model = self._ensure_model()

        start = time.time()
        result = model.transcribe(file_path)
        elapsed = time.time() - start

        # Log raw result shape
        raw_text = result.get("text")
        segments = result.get("segments")
        language = result.get("language")
        print(
            f"[WhisperX] Transcribe done in {elapsed:.2f}s — "
            f"text_len={len(raw_text or '')}, "
            f"segments={len(segments) if isinstance(segments, list) else 'n/a'}, "
            f"language={language}"
        )

        text = (raw_text or "").strip()

        # duration isn’t returned directly; we keep it in meta via pipeline timing
        return TranscriptionResult(text=text, language=language)

