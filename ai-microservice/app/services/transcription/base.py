from dataclasses import dataclass


@dataclass
class TranscriptionResult:
    text: str
    language: str | None = None


class Transcriber:
    def transcribe(self, file_path: str) -> TranscriptionResult:  # pragma: no cover
        raise NotImplementedError

