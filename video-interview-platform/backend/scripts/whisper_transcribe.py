#!/usr/bin/env python3
"""
Simple Whisper transcription script for Node.js backend.
Usage: python whisper_transcribe.py <video_path>
Output: JSON to stdout {"text": "transcribed text", "language": "en"}
"""

import sys
import json
import os
import warnings
warnings.filterwarnings("ignore")


def transcribe_with_model(whisper_module, model_name, video_path):
    model = whisper_module.load_model(model_name)
    return model.transcribe(
        video_path,
        fp16=False,
        verbose=False,
        temperature=0,
        condition_on_previous_text=False,
        best_of=1,
        beam_size=1
    )

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No video path provided"}))
        sys.exit(1)
    
    video_path = sys.argv[1]
    
    try:
        import whisper
    except ImportError:
        print(json.dumps({"error": "Whisper not installed. Run: pip install openai-whisper"}))
        sys.exit(1)
    
    try:
        # Load model (cached after first load).
        # Use a lightweight default model for better reliability on low-memory hosts.
        model_name = os.getenv("WHISPER_MODEL", "tiny.en")

        try:
            result = transcribe_with_model(whisper, model_name, video_path)
        except Exception as first_error:
            message = str(first_error)
            low_memory = "not enough memory" in message.lower() or "DefaultCPUAllocator" in message
            if low_memory and model_name != "tiny.en":
                fallback_model = "tiny.en"
                result = transcribe_with_model(whisper, fallback_model, video_path)
                model_name = fallback_model
            else:
                raise
        
        # Output JSON to stdout
        output = {
            "text": result["text"].strip(),
            "language": result.get("language", "en"),
            "model": model_name
        }
        print(json.dumps(output))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
