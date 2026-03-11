from pydantic import BaseModel, Field, HttpUrl


class EvaluateRequest(BaseModel):
    videoUrl: HttpUrl = Field(..., description="Cloudinary (or other) URL to the video asset")
    questionId: int | None = Field(default=None)
    questionText: str | None = Field(default=None)

    # Optional correlation IDs passed through from the orchestrator (Node)
    sessionId: str | None = Field(default=None)
    sessionVideoId: str | None = Field(default=None)

