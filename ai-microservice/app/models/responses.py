from pydantic import BaseModel


class Transcript(BaseModel):
    text: str
    language: str | None = None


class EvaluationRubric(BaseModel):
    clarity: float | None = None
    relevance: float | None = None
    structure: float | None = None
    examples: float | None = None
    completeness: float | None = None


class EvaluationResult(BaseModel):
    overallScore: float
    rationale: str
    rubric: EvaluationRubric


class EvaluateData(BaseModel):
    transcript: Transcript
    evaluation: EvaluationResult
    meta: dict


class EvaluateResponse(BaseModel):
    success: bool
    data: EvaluateData | None = None

