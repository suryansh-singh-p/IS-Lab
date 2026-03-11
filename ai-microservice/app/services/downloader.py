import os
import tempfile
from dataclasses import dataclass

import requests

from app.core.settings import Settings


@dataclass
class DownloadResult:
    path: str
    bytes_written: int
    content_type: str | None


def _guess_suffix(content_type: str | None) -> str:
    if not content_type:
        return ".bin"
    ct = content_type.split(";")[0].strip().lower()
    if ct in ("video/webm",):
        return ".webm"
    if ct in ("video/mp4", "video/mpeg4"):
        return ".mp4"
    if ct in ("video/x-matroska",):
        return ".mkv"
    return ".bin"


def download_to_tempfile(url: str, settings: Settings) -> DownloadResult:
    timeout = settings.download_timeout_sec
    chunk = settings.download_chunk_bytes
    max_bytes = settings.max_video_bytes

    with requests.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        content_type = r.headers.get("Content-Type")
        suffix = _guess_suffix(content_type)

        fd, path = tempfile.mkstemp(prefix="video-", suffix=suffix)
        bytes_written = 0
        try:
            with os.fdopen(fd, "wb") as f:
                for part in r.iter_content(chunk_size=chunk):
                    if not part:
                        continue
                    bytes_written += len(part)
                    if max_bytes is not None and bytes_written > max_bytes:
                        raise ValueError("Video exceeds MAX_VIDEO_BYTES limit")
                    f.write(part)
        except Exception:
            try:
                os.remove(path)
            except Exception:
                pass
            raise

    return DownloadResult(path=path, bytes_written=bytes_written, content_type=content_type)

