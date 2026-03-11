"""
Interview Answer Evaluation Pipeline
=====================================
1. Watches uploads folder for new videos
2. Transcribes with Whisper (API or local)
3. Evaluates with LLM (mark, emotions, areas to probe)
"""

import warnings
warnings.filterwarnings("ignore")

import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import json
import os
import time
from pathlib import Path
from typing import Optional

import requests
from openai import OpenAI
from dotenv import load_dotenv

# Try to import local whisper
try:
    import whisper
    USE_LOCAL_WHISPER = True
    print("✅ Using local Whisper model")
except ImportError:
    USE_LOCAL_WHISPER = False
    print("ℹ️ Local Whisper not found, will use OpenAI Whisper API")

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False

# Load environment variables (repo-relative so it works across machines)
REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ENV = REPO_ROOT / "video-interview-platform" / "backend" / ".env"
load_dotenv(dotenv_path=str(BACKEND_ENV))

# Configuration
UPLOADS_FOLDER = str(REPO_ROOT / "video-interview-platform" / "backend" / "uploads")
OUTPUT_FOLDER = str(REPO_ROOT / "After_video" / "evaluations")
QUESTIONS_FILE = str(REPO_ROOT / "After_video" / "current_questions.json")

# Create output folder if not exists
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# OpenRouter Client
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY"),
)

def transcribe_video(video_path):
    """Transcribe video using Whisper (local or API)"""
    print(f"\n📹 Processing video: {video_path}")
    
    try:
        if USE_LOCAL_WHISPER:
            # Use local whisper
            print("   Loading local Whisper model (tiny)...")
            model = whisper.load_model("tiny")
            
            print("   Transcribing (this may take a while)...")
            result = model.transcribe(video_path)
            
            full_text = result["text"].strip()
            segments = result.get("segments", [])
        else:
            # Use OpenAI Whisper API (requires OpenAI API key)
            print("   Using OpenAI Whisper API...")
            
            # For OpenAI API, we need actual OpenAI key, not OpenRouter
            # Let's use a simpler approach - read from existing transcripts if available
            # Or use a placeholder for now
            
            print("   ⚠️ OpenAI Whisper API requires separate API key")
            print("   Please install local whisper: pip install openai-whisper")
            return None, None
        
        print(f"   ✅ Transcription complete: {len(full_text)} characters")
        return full_text, segments
        
    except Exception as e:
        print(f"   ❌ Transcription error: {e}")
        import traceback
        traceback.print_exc()
        return None, None


def download_video_to_temp(url: str) -> Optional[str]:
    """Download a remote video (e.g. Cloudinary secure_url) to a temporary file.

    Returns the local file path, or None on error.
    """
    import tempfile

    print(f"\n🌐 Downloading video from URL:\n   {url}")
    try:
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            suffix = ".webm"
            ct = r.headers.get("Content-Type") or ""
            if "mp4" in ct:
                suffix = ".mp4"
            fd, temp_path = tempfile.mkstemp(prefix="cloud-video-", suffix=suffix)
            bytes_written = 0
            with os.fdopen(fd, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    f.write(chunk)
                    bytes_written += len(chunk)
        mb = bytes_written / (1024 * 1024)
        print(f"   ✅ Download complete: {mb:.2f} MB → {temp_path}")
        return temp_path
    except Exception as e:
        print(f"   ❌ Download error: {e}")
        return None


def evaluate_answer(question, answer_transcript):
    """Send to LLM for evaluation"""
    print("\n🤖 Evaluating answer with AI...")
    
    evaluation_prompt = f"""You are an expert interview evaluator and hiring manager. You must evaluate the candidate's answer honestly and critically.

INTERVIEW QUESTION:
"{question}"

CANDIDATE'S ANSWER (transcribed from video):
"{answer_transcript}"

Evaluate this answer and provide your assessment in the following JSON format ONLY (no other text):

{{
    "mark": <number from 1-10>,
    "mark_justification": "<brief explanation of the score>",
    "content_analysis": {{
        "relevance": "<how relevant was the answer to the question>",
        "completeness": "<did they fully address the question>",
        "clarity": "<how clear and structured was the response>",
        "examples": "<did they provide specific examples or stories>"
    }},
    "expected_emotions": {{
        "should_show": ["<list of emotions that should be present like confidence, enthusiasm, sincerity>"],
        "red_flags": ["<only include if there are serious concerns like dishonesty, aggression, extreme nervousness - leave empty array if none>"]
    }},
    "areas_to_probe": [
        "<discrepancy, gap, or thing that needs clarification 1>",
        "<discrepancy, gap, or thing that needs clarification 2 if applicable>",
        "<discrepancy, gap, or thing that needs clarification 3 if applicable>"
    ],
    "improvement_suggestions": "<what could have made this answer better>",
    "overall_impression": "<brief professional assessment>"
}}

Be honest and critical. A perfect 10 should be rare. Most good answers are 6-8.
For areas_to_probe, focus on discrepancies in the answer, things that don't add up, gaps that need clarification, or claims that should be verified.
Only include red_flags if there are genuinely concerning indicators - an empty array is perfectly acceptable.
"""

    try:
        response = client.chat.completions.create(
            model="nvidia/nemotron-nano-9b-v2:free",
            messages=[
                {"role": "system", "content": "You are a strict but fair interview evaluator. Output ONLY valid JSON."},
                {"role": "user", "content": evaluation_prompt}
            ]
        )
        
        result_text = response.choices[0].message.content
        
        # Try to parse JSON
        try:
            # Clean up the response if needed
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0]
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0]
            
            evaluation = json.loads(result_text.strip())
            print("   ✅ Evaluation complete")
            return evaluation
        except json.JSONDecodeError as e:
            print(f"   ⚠️ JSON parse error, returning raw response")
            return {"raw_response": result_text, "parse_error": str(e)}
            
    except Exception as e:
        print(f"   ❌ Evaluation error: {e}")
        return {"error": str(e)}


def process_video_file(video_path, question_text="Tell me about yourself"):
    """Complete pipeline: transcribe + evaluate"""
    
    # Step 1: Transcribe
    transcript, segments = transcribe_video(video_path)
    
    if not transcript:
        return None
    
    # Step 2: Evaluate
    evaluation = evaluate_answer(question_text, transcript)
    
    # Step 3: Build final result
    result = {
        "video_file": video_path,
        "question": question_text,
        "transcript": transcript,
        "evaluation": evaluation,
        "processed_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Step 4: Save to file - follow same naming convention as video (candidateName_Q#)
    video_name = Path(video_path).stem  # e.g., "JohnDoe_Q1"
    video_dir = Path(video_path).parent  # Get the candidate's folder
    
    # Create evaluation in same candidate folder or in evaluations folder
    if video_dir.name.startswith("candidate_"):
        # Save evaluation alongside video in candidate folder
        output_file = video_dir / f"{video_name}_evaluation.json"
    else:
        # Fallback to evaluations folder
        output_file = Path(OUTPUT_FOLDER) / f"{video_name}_evaluation.json"
    
    os.makedirs(output_file.parent, exist_ok=True)
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(f"\n📊 EVALUATION SAVED: {output_file}")
    print_evaluation_summary(evaluation)
    
    return result


def evaluate_cloud_video(video_url: str, question_text: str = "Tell me about yourself") -> Optional[dict]:
    """End-to-end evaluation for a single remote (Cloudinary) video URL.

    1) Download video to temp file
    2) Transcribe with Whisper (local)
    3) Evaluate with LLM
    """
    local_path = download_video_to_temp(video_url)
    if not local_path:
        return None

    try:
        transcript, segments = transcribe_video(local_path)
        if not transcript:
            print("❌ Empty transcript from downloaded video, skipping evaluation.")
            return None

        evaluation = evaluate_answer(question_text, transcript)
        result = {
            "video_url": video_url,
            "question": question_text,
            "transcript": transcript,
            "segments": segments,
            "evaluation": evaluation,
            "processed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        print("\n✅ Cloud video evaluation complete.")
        print_evaluation_summary(evaluation)
        return result
    finally:
        try:
            os.remove(local_path)
        except Exception:
            pass


def print_evaluation_summary(evaluation):
    """Print a nice summary of the evaluation"""
    print("\n" + "="*60)
    print("📋 EVALUATION SUMMARY")
    print("="*60)
    
    if "error" in evaluation:
        print(f"❌ Error: {evaluation['error']}")
        return
    
    if "raw_response" in evaluation:
        print(f"⚠️ Raw response: {evaluation['raw_response'][:500]}...")
        return
    
    print(f"\n🎯 MARK: {evaluation.get('mark', 'N/A')}/10")
    print(f"   Justification: {evaluation.get('mark_justification', 'N/A')}")
    
    print(f"\n😀 EXPECTED EMOTIONS:")
    emotions = evaluation.get('expected_emotions', {})
    print(f"   Should show: {', '.join(emotions.get('should_show', []))}")
    red_flags = emotions.get('red_flags', [])
    if red_flags and len(red_flags) > 0 and red_flags[0]:
        print(f"   ⚠️ Red flags: {', '.join(red_flags)}")
    else:
        print(f"   Red flags: None")
    
    print(f"\n🔍 AREAS TO PROBE:")
    areas = evaluation.get('areas_to_probe', evaluation.get('follow_up_questions', []))
    for i, area in enumerate(areas, 1):
        print(f"   {i}. {area}")
    
    print(f"\n💡 IMPROVEMENT: {evaluation.get('improvement_suggestions', 'N/A')}")
    print(f"\n📝 OVERALL: {evaluation.get('overall_impression', 'N/A')}")
    print("="*60)


def process_all_videos_in_folder():
    """Process all unprocessed videos in uploads folder (including candidate subfolders)"""
    print(f"\n🔍 Scanning folder: {UPLOADS_FOLDER}")
    
    # Sample questions (in real scenario, load from saved questions)
    sample_questions = [
        "Tell me about yourself and your background.",
        "What motivates you in your career?",
        "Describe a challenging situation you faced at work.",
    ]
    
    # Collect all videos from uploads root and candidate subfolders
    all_videos = []
    
    # Check root uploads folder
    for f in os.listdir(UPLOADS_FOLDER):
        full_path = os.path.join(UPLOADS_FOLDER, f)
        if os.path.isfile(full_path) and f.endswith(('.webm', '.mp4', '.mkv')):
            all_videos.append(full_path)
        elif os.path.isdir(full_path) and f.startswith("candidate_"):
            # Check candidate subfolders
            for video_file in os.listdir(full_path):
                if video_file.endswith(('.webm', '.mp4', '.mkv')):
                    all_videos.append(os.path.join(full_path, video_file))
    
    print(f"   Found {len(all_videos)} video(s)")
    
    for i, video_path in enumerate(all_videos):
        video_stem = Path(video_path).stem
        video_dir = Path(video_path).parent
        
        # Check if already processed (evaluation file exists alongside video)
        eval_file = video_dir / f"{video_stem}_evaluation.json"
        if eval_file.exists():
            print(f"   ⏭️ Skipping (already processed): {video_path}")
            continue
        
        # Try to extract question number from filename (e.g., "JohnDoe_Q1")
        question_num = 0
        if "_Q" in video_stem:
            try:
                question_num = int(video_stem.split("_Q")[-1]) - 1
            except ValueError:
                pass
        
        question = sample_questions[question_num % len(sample_questions)]
        
        print(f"\n{'='*60}")
        print(f"Processing video {i+1}/{len(all_videos)}: {Path(video_path).name}")
        print(f"Question: {question}")
        print('='*60)
        
        process_video_file(video_path, question)


class VideoHandler(FileSystemEventHandler if WATCHDOG_AVAILABLE else object):
    """Watch for new video files"""
    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith(('.webm', '.mp4', '.mkv')):
            print(f"\n🆕 New video detected: {event.src_path}")
            # Wait a bit for file to be fully written
            time.sleep(2)
            
            # Try to extract question info from filename (e.g., JohnDoe_Q1)
            video_stem = Path(event.src_path).stem
            question_text = "Tell me about yourself"
            
            # You could load actual questions from a questions file here
            process_video_file(event.src_path, question_text)


def watch_folder():
    """Watch uploads folder for new videos (including candidate subfolders)"""
    if not WATCHDOG_AVAILABLE:
        print("❌ Watchdog not installed. Install with: pip install watchdog")
        return
        
    print(f"\n👁️ Watching folder: {UPLOADS_FOLDER} (including subfolders)")
    print("Press Ctrl+C to stop\n")
    
    event_handler = VideoHandler()
    observer = Observer()
    # Set recursive=True to watch candidate subfolders
    observer.schedule(event_handler, UPLOADS_FOLDER, recursive=True)
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    import sys
    
    print("\n" + "="*60)
    print("🎬 INTERVIEW EVALUATION PIPELINE")
    print("="*60)
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--watch":
            watch_folder()
        elif sys.argv[1] == "--process-all":
            process_all_videos_in_folder()
        else:
            # Process specific video
            video_path = sys.argv[1]
            question = sys.argv[2] if len(sys.argv) > 2 else "Tell me about yourself"
            process_video_file(video_path, question)
    else:
        print("\nUsage:")
        print("  python evaluate_interview.py --watch         # Watch for new videos")
        print("  python evaluate_interview.py --process-all   # Process all videos in uploads")
        print("  python evaluate_interview.py <video_path> [question]  # Process specific video")
        print("\nRunning --process-all by default...\n")
        process_all_videos_in_folder()
