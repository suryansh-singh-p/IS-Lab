from app.services.transcription.base import Transcriber, TranscriptionResult


class StubTranscriber(Transcriber):
    def transcribe(self, file_path: str) -> TranscriptionResult:
        # Minimal placeholder so the service can run without heavy binaries/models.
        return TranscriptionResult(text="", language=None)

