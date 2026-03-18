"""
Whisper Interview Processing Pipeline
======================================
Watches candidate folders for new videos, transcribes with Whisper,
evaluates with LLM, and maintains two files per candidate:
1. {candidateName}_answers.json - All transcribed answers
2. {candidateName}_evaluation.json - All evaluation results
"""

import warnings
warnings.filterwarnings("ignore")

import json
import os
import time
from pathlib import Path
from datetime import datetime
from openai import OpenAI
from dotenv import load_dotenv

# Load whisper
try:
    import whisper
    WHISPER_MODEL = None  # Lazy load
    print("✅ Whisper installed and ready")
except ImportError:
    print("❌ Whisper not installed. Run: pip install openai-whisper")
    exit(1)

# Load watchdog
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    print("✅ Watchdog installed and ready")
except ImportError:
    print("❌ Watchdog not installed. Run: pip install watchdog")
    exit(1)

# Load environment
# Resolve paths relative to this repo so it works on any machine/path.
REPO_ROOT = Path(__file__).resolve().parents[1]  # .../IS Lab
BACKEND_DIR = REPO_ROOT / "video-interview-platform" / "backend"
ENV_PATH = BACKEND_DIR / ".env"

if ENV_PATH.exists():
    load_dotenv(dotenv_path=ENV_PATH)
else:
    # Still allow running if user exports env vars in the shell.
    print(f"⚠️ .env not found at: {ENV_PATH}")

# Configuration
UPLOADS_FOLDER = str(BACKEND_DIR / "uploads")
WHISPER_MODEL_SIZE = "base"  # Options: tiny, base, small, medium, large

# OpenRouter Client for LLM evaluation
api_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")
if not api_key:
    raise SystemExit(
        "Missing API key. Set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY.\n"
        f"Looked for .env at: {ENV_PATH}"
    )

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key,
)

# Store loaded questions per candidate
candidate_questions = {}


def load_whisper_model():
    """Lazy load whisper model"""
    global WHISPER_MODEL
    if WHISPER_MODEL is None:
        print(f"\n📥 Loading Whisper model ({WHISPER_MODEL_SIZE})... This may take a moment.")
        WHISPER_MODEL = whisper.load_model(WHISPER_MODEL_SIZE)
        print("✅ Whisper model loaded!")
    return WHISPER_MODEL


def transcribe_video(video_path):
    """Transcribe video using Whisper"""
    print(f"\n🎙️ Transcribing: {Path(video_path).name}")
    
    try:
        model = load_whisper_model()
        
        start_time = time.time()
        result = model.transcribe(video_path)
        elapsed = time.time() - start_time
        
        transcript = result["text"].strip()
        print(f"   ✅ Transcription complete ({elapsed:.1f}s): {len(transcript)} characters")
        
        return {
            "text": transcript,
            "segments": result.get("segments", []),
            "language": result.get("language", "en"),
            "duration": elapsed
        }
    except Exception as e:
        print(f"   ❌ Transcription error: {e}")
        return None


def evaluate_answer(question, answer_transcript):
    """Evaluate answer with LLM"""
    print("   🤖 Evaluating with AI...")
    
    evaluation_prompt = f"""You are an expert interview evaluator. Evaluate this answer honestly and critically.

QUESTION: "{question}"

CANDIDATE'S ANSWER: "{answer_transcript}"

Provide your assessment in JSON format ONLY:

{{
    "mark": <1-10>,
    "mark_justification": "<brief explanation>",
    "content_analysis": {{
        "relevance": "<how relevant to the question>",
        "completeness": "<did they fully address it>",
        "clarity": "<how clear and structured>",
        "examples": "<did they provide examples>"
    }},
    "expected_emotions": {{
        "should_show": ["<emotions like confidence, enthusiasm, sincerity>"],
        "red_flags": ["<only serious concerns like dishonesty, aggression - empty if none>"]
    }},
    "areas_to_probe": [
        "<discrepancy or gap needing clarification>",
        "<thing that doesn't add up or needs verification>"
    ],
    "improvement_suggestions": "<what could be better>",
    "overall_impression": "<brief professional assessment>"
}}

Be honest. Perfect 10 is rare. Good answers are 6-8.
Only include red_flags for serious concerns - empty array is fine.
"""

    try:
        response = client.chat.completions.create(
            model="nvidia/nemotron-nano-9b-v2:free",
            messages=[
                {"role": "system", "content": "You are a strict interview evaluator. Output ONLY valid JSON."},
                {"role": "user", "content": evaluation_prompt}
            ]
        )
        
        result_text = response.choices[0].message.content
        
        # Clean and parse JSON
        if "```json" in result_text:
            result_text = result_text.split("```json")[1].split("```")[0]
        elif "```" in result_text:
            result_text = result_text.split("```")[1].split("```")[0]
        
        evaluation = json.loads(result_text.strip())
        print("   ✅ Evaluation complete")
        return evaluation
        
    except json.JSONDecodeError as e:
        print(f"   ⚠️ JSON parse error: {e}")
        return {"error": "JSON parse error", "raw": result_text[:500]}
    except Exception as e:
        print(f"   ❌ Evaluation error: {e}")
        return {"error": str(e)}


def get_question_for_video(video_path):
    """Get the question text for a video based on Q number"""
    video_name = Path(video_path).stem  # e.g., "JohnDoe_Q1"
    candidate_folder = Path(video_path).parent
    
    # Try to load questions from candidate's questions.json
    questions_file = candidate_folder / "questions.json"
    
    if questions_file.exists():
        try:
            with open(questions_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                questions = data if isinstance(data, list) else data.get('questions', [])
        except:
            questions = []
    else:
        questions = []
    
    # Extract question number from filename
    question_num = 1
    if "_Q" in video_name:
        try:
            question_num = int(video_name.split("_Q")[-1])
        except ValueError:
            pass
    
    # Get question text
    if questions and question_num <= len(questions):
        q = questions[question_num - 1]
        return q.get('text', q) if isinstance(q, dict) else q
    else:
        # Fallback questions
        fallback = [
            "Tell me about yourself and your background.",
            "What are your key strengths?",
            "Describe a challenging project you worked on.",
            "Why are you interested in this role?",
            "Where do you see yourself in 5 years?",
            "How do you handle pressure and deadlines?",
            "Tell me about a time you showed leadership.",
            "What's your greatest achievement?",
            "How do you stay updated in your field?",
            "Do you have any questions for us?"
        ]
        return fallback[(question_num - 1) % len(fallback)]


def update_evaluation_file(candidate_folder, candidate_name, question_num, question_text, transcript, evaluation):
    """Update the cumulative evaluation file"""
    eval_file = candidate_folder / f"{candidate_name}_evaluation.json"
    
    # Load existing data or create new
    if eval_file.exists():
        with open(eval_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    else:
        data = {
            "candidate_name": candidate_name,
            "interview_date": datetime.now().strftime("%Y-%m-%d"),
            "evaluations": {},
            "summary": {
                "total_marks": 0,
                "questions_evaluated": 0,
                "average_score": 0,
                "all_areas_to_probe": [],
                "all_red_flags": []
            }
        }
    
    # Add/update this evaluation
    data["evaluations"][f"Q{question_num}"] = {
        "question": question_text,
        "transcript": transcript,
        "evaluation": evaluation,
        "evaluated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Update summary
    total_marks = 0
    all_areas = []
    all_red_flags = []
    
    for q_key, q_data in data["evaluations"].items():
        ev = q_data.get("evaluation", {})
        if "mark" in ev:
            total_marks += ev["mark"]
        
        areas = ev.get("areas_to_probe", [])
        all_areas.extend([f"{q_key}: {a}" for a in areas if a])
        
        emotions = ev.get("expected_emotions", {})
        flags = emotions.get("red_flags", [])
        all_red_flags.extend([f"{q_key}: {f}" for f in flags if f])
    
    num_evaluated = len(data["evaluations"])
    data["summary"] = {
        "total_marks": total_marks,
        "questions_evaluated": num_evaluated,
        "average_score": round(total_marks / num_evaluated, 2) if num_evaluated > 0 else 0,
        "all_areas_to_probe": all_areas,
        "all_red_flags": all_red_flags if all_red_flags else ["None identified"]
    }
    
    data["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Save
    with open(eval_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"   📊 Updated: {eval_file.name}")
    return eval_file


def process_video(video_path):
    """Complete pipeline: transcribe + evaluate + update files"""
    video_path = Path(video_path)
    video_name = video_path.stem  # e.g., "JohnDoe_Q1"
    candidate_folder = video_path.parent
    
    # Extract candidate name and question number
    if "_Q" in video_name:
        parts = video_name.rsplit("_Q", 1)
        candidate_name = parts[0]
        try:
            question_num = int(parts[1])
        except ValueError:
            question_num = 1
    else:
        candidate_name = video_name
        question_num = 1
    
    print(f"\n{'='*60}")
    print(f"📹 Processing: {video_name}")
    print(f"   Candidate: {candidate_name}")
    print(f"   Question #: {question_num}")
    print('='*60)
    
    # Get question text
    question_text = get_question_for_video(video_path)
    print(f"   Question: {question_text[:80]}...")
    
    # Step 1: Transcribe with Whisper
    transcript_data = transcribe_video(str(video_path))
    
    if not transcript_data or not transcript_data["text"]:
        print("   ❌ Failed to transcribe video")
        return None
    
    transcript = transcript_data["text"]
    print(f"\n   📜 Transcript Preview: {transcript[:150]}...")
    
    # Step 2: Evaluate with LLM
    evaluation = evaluate_answer(question_text, transcript)
    
    # Step 3: Update evaluation file (includes transcript)
    update_evaluation_file(candidate_folder, candidate_name, question_num, question_text, transcript, evaluation)
    
    # Print summary
    print_evaluation_summary(evaluation, question_num)
    
    return {
        "video": video_name,
        "transcript": transcript,
        "evaluation": evaluation
    }


def print_evaluation_summary(evaluation, question_num):
    """Print a nice summary"""
    print(f"\n📋 Q{question_num} EVALUATION:")
    print("-" * 40)
    
    if "error" in evaluation:
        print(f"   ❌ Error: {evaluation['error']}")
        return
    
    mark = evaluation.get('mark', 'N/A')
    print(f"   🎯 Mark: {mark}/10")
    print(f"   💬 {evaluation.get('mark_justification', 'N/A')}")
    
    emotions = evaluation.get('expected_emotions', {})
    should_show = emotions.get('should_show', [])
    print(f"   😀 Emotions: {', '.join(should_show[:3])}")
    
    red_flags = emotions.get('red_flags', [])
    if red_flags and red_flags[0]:
        print(f"   ⚠️ Red Flags: {', '.join(red_flags)}")
    
    areas = evaluation.get('areas_to_probe', [])
    if areas:
        print(f"   🔍 Areas to Probe: {areas[0][:60]}...")
    
    print("-" * 40)


class VideoHandler(FileSystemEventHandler):
    """Handle new video file events"""
    
    def __init__(self):
        self.processing = set()  # Track files being processed
    
    def on_created(self, event):
        if event.is_directory:
            return
        
        file_path = event.src_path
        
        # Only process video files
        if not file_path.endswith(('.webm', '.mp4', '.mkv')):
            return
        
        # Skip if already processing
        if file_path in self.processing:
            return
        
        self.processing.add(file_path)
        
        try:
            print(f"\n🆕 New video detected: {Path(file_path).name}")
            
            # Wait for file to be fully written
            print("   ⏳ Waiting for file to finish writing...")
            time.sleep(3)
            
            # Check if file still exists (might be temp file)
            if not os.path.exists(file_path):
                print("   ⚠️ File no longer exists (was temporary)")
                return
            
            # Check file size is stable
            prev_size = 0
            for _ in range(5):
                if not os.path.exists(file_path):
                    print("   ⚠️ File disappeared during processing")
                    return
                curr_size = os.path.getsize(file_path)
                if curr_size == prev_size and curr_size > 0:
                    break
                prev_size = curr_size
                time.sleep(1)
            
            # Process the video
            process_video(file_path)
            
        except Exception as e:
            print(f"   ❌ Error processing video: {e}")
        finally:
            self.processing.discard(file_path)


def watch_and_process():
    """Main function: Watch uploads folder and process videos"""
    print("\n" + "="*60)
    print("🎬 WHISPER INTERVIEW PIPELINE")
    print("="*60)
    print(f"\n📁 Watching: {UPLOADS_FOLDER}")
    print(f"🎙️ Whisper model: {WHISPER_MODEL_SIZE}")
    print("\nFiles created per candidate:")
    print("   • {name}_answers.json - All transcribed answers")
    print("   • {name}_evaluation.json - All evaluation results")
    print("\n⏳ Waiting for videos... (Press Ctrl+C to stop)\n")
    
    # Process any existing unprocessed videos first
    process_existing_videos()
    
    # Start watching for new videos
    event_handler = VideoHandler()
    observer = Observer()
    observer.schedule(event_handler, UPLOADS_FOLDER, recursive=True)
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n👋 Stopping pipeline...")
        observer.stop()
    
    observer.join()
    print("✅ Pipeline stopped.")


def process_existing_videos():
    """Process any videos that haven't been processed yet"""
    print("🔍 Checking for unprocessed videos...")
    
    unprocessed = []
    
    # Scan all folders in uploads (with or without candidate_ prefix)
    for item in os.listdir(UPLOADS_FOLDER):
        item_path = Path(UPLOADS_FOLDER) / item
        
        # Check if it's a directory (candidate folder)
        if item_path.is_dir():
            # Check each video in candidate folder
            for video_file in item_path.glob("*.webm"):
                video_name = video_file.stem
                
                # Extract candidate name from video filename
                if "_Q" in video_name:
                    candidate_name = video_name.rsplit("_Q", 1)[0]
                else:
                    candidate_name = video_name
                
                # Check if already processed (exists in answers file)
                answers_file = item_path / f"{candidate_name}_answers.json"
                
                if answers_file.exists():
                    with open(answers_file, 'r') as f:
                        data = json.load(f)
                    
                    # Extract Q number
                    q_key = f"Q{video_name.split('_Q')[-1]}" if "_Q" in video_name else "Q1"
                    
                    if q_key in data.get("answers", {}):
                        continue  # Already processed
                
                unprocessed.append(str(video_file))
        
        # Also check for videos directly in uploads folder
        elif item_path.is_file() and item.endswith('.webm'):
            # These are old format videos, skip them or process separately
            print(f"   ⚠️ Found video in root uploads (old format): {item}")
    
    if unprocessed:
        print(f"   Found {len(unprocessed)} unprocessed video(s)")
        for video_path in sorted(unprocessed):
            process_video(video_path)
    else:
        print("   No unprocessed videos found.")


if __name__ == "__main__":
    watch_and_process()
