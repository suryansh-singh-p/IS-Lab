from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BaselineEvaluation:
    overall_score: float
    rationale: str
    rubric: dict


def evaluate_baseline(question_text: str | None, transcript_text: str) -> BaselineEvaluation:
    """
    Minimal evaluation (deterministic, zero external dependencies).
    This is intentionally simple so the microservice is runnable before plugging a GGUF LLM.
    """
    t = (transcript_text or "").strip()
    q = (question_text or "").strip()

    if not t:
        return BaselineEvaluation(
            overall_score=0.0,
            rationale="Empty transcript (no detectable speech or transcription not configured).",
            rubric={"clarity": 0, "relevance": 0, "structure": 0, "examples": 0, "completeness": 0},
        )

    # Naive heuristics based on length and simple cues.
    words = [w for w in t.split() if w]
    word_count = len(words)
    has_examples = any(k in t.lower() for k in ("for example", "for instance", "e.g.", "i did", "i worked", "we "))
    has_structure = any(k in t.lower() for k in ("first", "second", "third", "then", "finally"))
    mentions_question = q and any(token in t.lower() for token in q.lower().split()[:3])

    completeness = min(10.0, max(2.0, word_count / 25.0))  # ~250 words => 10
    clarity = min(10.0, max(2.0, 2.0 + word_count / 40.0))
    structure = 7.0 if has_structure else 4.5
    examples = 7.5 if has_examples else 4.0
    relevance = 7.0 if mentions_question else 5.5

    overall = round((clarity * 0.25 + relevance * 0.25 + structure * 0.2 + examples * 0.15 + completeness * 0.15), 2)
    rationale = f"Baseline heuristic evaluation based on transcript length ({word_count} words) and simple cues."

    return BaselineEvaluation(
        overall_score=overall,
        rationale=rationale,
        rubric={
            "clarity": round(clarity, 1),
            "relevance": round(relevance, 1),
            "structure": round(structure, 1),
            "examples": round(examples, 1),
            "completeness": round(completeness, 1),
        },
    )

