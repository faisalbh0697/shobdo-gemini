"""Local Whisper (MLX) transcription server for Apple Silicon."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

import mlx_whisper
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# large-v3-mlx = best quality on Apple Silicon; turbo = faster.
# Override with WHISPER_MODEL=mlx-community/whisper-large-v3-turbo
DEFAULT_MODEL = "mlx-community/whisper-large-v3-mlx"
MODEL = os.environ.get("WHISPER_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
HOST = os.environ.get("WHISPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("WHISPER_PORT", "8765"))

app = FastAPI(title="Shobdo local Whisper", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model_ready = False


def ensure_model_loaded() -> None:
    """Warm the model once so the first request is not a surprise download stall."""
    global _model_ready
    if _model_ready:
        return
    import struct
    import wave

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = tmp.name
    try:
        with wave.open(path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            frames = b"".join(struct.pack("<h", 0) for _ in range(800))
            wf.writeframes(frames)
        print(f"Loading Whisper model: {MODEL}", flush=True)
        mlx_whisper.transcribe(
            path,
            path_or_hf_repo=MODEL,
            word_timestamps=False,
            verbose=False,
        )
        _model_ready = True
        print("Whisper model ready.", flush=True)
    finally:
        Path(path).unlink(missing_ok=True)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "model": MODEL, "ready": _model_ready}


@app.on_event("startup")
def on_startup() -> None:
    ensure_model_loaded()


def extract_words(result: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in result.get("segments") or []:
        for item in segment.get("words") or []:
            word = str(item.get("word") or "").strip()
            if not word:
                continue
            start = float(item.get("start") or 0)
            end = float(item.get("end") or start)
            words.append({"word": word, "start": start, "end": max(end, start)})
    return words


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(""),
    initial_prompt: str = Form(""),
) -> JSONResponse:
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    raw = await file.read()
    if not raw:
        return JSONResponse({"error": "খালি অডিও ফাইল।"}, status_code=400)

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        path = tmp.name

    try:
        kwargs: dict[str, Any] = {
            "path_or_hf_repo": MODEL,
            "word_timestamps": True,
            "verbose": False,
            "temperature": 0.0,
            "condition_on_previous_text": True,
            "no_speech_threshold": 0.6,
            "compression_ratio_threshold": 2.4,
            "logprob_threshold": -1.0,
        }
        lang = language.strip().lower()
        if lang and lang != "auto":
            kwargs["language"] = lang
        prompt = initial_prompt.strip()
        if prompt:
            kwargs["initial_prompt"] = prompt[:800]

        result = mlx_whisper.transcribe(path, **kwargs)
    except Exception as exc:  # noqa: BLE001 — surface to client
        return JSONResponse(
            {"error": f"লোকাল Whisper ফেল: {exc}"},
            status_code=500,
        )
    finally:
        Path(path).unlink(missing_ok=True)

    words = extract_words(result if isinstance(result, dict) else {})
    text = str((result or {}).get("text") or "").strip()
    if not text and words:
        text = " ".join(w["word"] for w in words)

    duration = None
    segments = (result or {}).get("segments") or []
    if segments:
        duration = float(segments[-1].get("end") or 0)
    elif words:
        duration = float(words[-1]["end"])

    detected = (result or {}).get("language")
    payload: dict[str, Any] = {"text": text, "words": words}
    if detected:
        payload["language"] = detected
    if duration is not None:
        payload["duration"] = duration
    return JSONResponse(payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host=HOST, port=PORT, reload=False)
