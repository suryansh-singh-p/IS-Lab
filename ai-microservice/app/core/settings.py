from pydantic import BaseModel


class Settings(BaseModel):
    # Transcription
    transcriber_backend: str = "stub"  # "stub" | "whisperx"
    whisperx_model: str = "medium.en"  # whisperx model id or path
    whisperx_compute_type: str = "int8"

    # Networking / download
    download_timeout_sec: int = 120
    download_chunk_bytes: int = 1024 * 1024
    max_video_bytes: int | None = None  # optional guardrail


def get_settings() -> Settings:
    # Keep dependencies minimal: read env manually (no python-dotenv).
    import os

    def getenv_int(key: str, default: int) -> int:
        val = os.getenv(key)
        if val is None or val == "":
            return default
        return int(val)

    def getenv_optional_int(key: str) -> int | None:
        val = os.getenv(key)
        if val is None or val == "":
            return None
        return int(val)

    return Settings(
        transcriber_backend=os.getenv("TRANSCRIBER_BACKEND", "stub"),
        whisperx_model=os.getenv("WHISPERX_MODEL", "medium.en"),
        whisperx_compute_type=os.getenv("WHISPERX_COMPUTE_TYPE", "int8"),
        download_timeout_sec=getenv_int("DOWNLOAD_TIMEOUT_SEC", 120),
        download_chunk_bytes=getenv_int("DOWNLOAD_CHUNK_BYTES", 1024 * 1024),
        max_video_bytes=getenv_optional_int("MAX_VIDEO_BYTES"),
    )

