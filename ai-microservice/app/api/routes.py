from fastapi import APIRouter, HTTPException

from app.models.requests import EvaluateRequest
from app.models.responses import EvaluateResponse
from app.services.pipeline import evaluate_video_answer

router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True}


@router.post("/v1/evaluate", response_model=EvaluateResponse)
def evaluate(req: EvaluateRequest):
    try:
        data = evaluate_video_answer(req)
        return EvaluateResponse(success=True, data=data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Keep error messages minimal in prod, but useful for early integration.
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {e}")

