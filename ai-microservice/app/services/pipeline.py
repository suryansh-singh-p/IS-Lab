import os
import time

from app.core.settings import get_settings
from app.models.requests import EvaluateRequest
from app.models.responses import EvaluateData, EvaluationResult, EvaluationRubric, Transcript
from app.services.downloader import download_to_tempfile
from app.services.evaluation.baseline import evaluate_baseline
from app.services.transcription.stub import StubTranscriber
from app.services.transcription.whisperx_backend import WhisperXTranscriber


def _get_transcriber():
    settings = get_settings()
    backend = (settings.transcriber_backend or "stub").lower().strip()

    if backend == "whisperx":
        return WhisperXTranscriber(settings)

    return StubTranscriber()


def evaluate_video_answer(req: EvaluateRequest) -> EvaluateData:
    settings = get_settings()
    start = time.time()

    dl = download_to_tempfile(str(req.videoUrl), settings=settings)
    transcriber = _get_transcriber()

    try:
        tr = transcriber.transcribe(dl.path)
        baseline = evaluate_baseline(req.questionText, tr.text)
    finally:
        # Always delete temp download
        try:
            os.remove(dl.path)
        except Exception:
            pass

    elapsed_ms = int((time.time() - start) * 1000)

    return EvaluateData(
        transcript=Transcript(text=tr.text, language=tr.language),
        evaluation=EvaluationResult(
            overallScore=baseline.overall_score,
            rationale=baseline.rationale,
            rubric=EvaluationRubric(**baseline.rubric),
        ),
        meta={
            "timingMs": {"total": elapsed_ms},
            "download": {"bytes": dl.bytes_written, "contentType": dl.content_type},
            "source": {
                "videoUrl": str(req.videoUrl),
                "sessionId": req.sessionId,
                "sessionVideoId": req.sessionVideoId,
                "questionId": req.questionId,
            },
            "backend": {"transcriber": get_settings().transcriber_backend},
        },
    )

