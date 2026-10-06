from flask import Flask, jsonify, request
from flask_cors import CORS
from google import genai
import requests
import tempfile
import base64
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__)

# CORS: allow the deployed Render frontend plus local dev origins.
# Production frontend: https://travelguide-frontend.onrender.com
# Override/extend via ALLOWED_ORIGINS or FRONTEND_URL env vars, e.g.
# ALLOWED_ORIGINS="https://travelguide-frontend.onrender.com"
# or FRONTEND_URL="https://travelguide-frontend.onrender.com".
PRODUCTION_FRONTEND_URL = "https://travelguide-frontend.onrender.com"
LOCAL_DEV_ORIGINS = [
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]


def _allowed_origins():
    raw = os.getenv("ALLOWED_ORIGINS", "") or os.getenv("FRONTEND_URL", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    for default_origin in [PRODUCTION_FRONTEND_URL, *LOCAL_DEV_ORIGINS]:
        if default_origin not in origins:
            origins.append(default_origin)
    return origins


CORS(
    app,
    origins=_allowed_origins(),
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# Credentials come ONLY from environment. No defaults, no fallbacks.
MURF_API_KEY = os.getenv("MURF_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

PROMPTS = {
    "Summary": """
You are a professional tourist guide.
Provide a high-level overview of "{place}" in {language}.

Focus on:
- The historical significance
- Why the place is famous
- Key architectural or cultural highlights

Keep the explanation concise, engaging, and easy to follow.
Avoid excessive details and dates.
Limit the response to around 200 words.

Respond ONLY in {language}.
""",

    "Detailed": """
You are a professional tourist guide.
Provide a detailed and immersive explanation of "{place}" in {language}.

Cover:
- Historical background and timeline
- Architectural design and unique features
- Cultural importance and notable events
- Interesting facts and visitor insights

Explain concepts clearly and in a storytelling manner.
Include relevant details and examples to create a rich experience.
Limit the response to around 400 words.

Respond ONLY in {language}.
"""
}


def _get_gemini_client():
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server.")
    return genai.Client(api_key=GEMINI_API_KEY)


def generate_speech(text, voice_id, locale):
    if not MURF_API_KEY:
        raise RuntimeError("MURF_API_KEY is not configured on the server.")
    text = (text or "").strip()[:3000]
    if not text:
        raise ValueError("Empty text for speech synthesis")

    temp_audio = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    temp_audio.close()

    url = "https://global.api.murf.ai/v1/speech/stream"
    headers = {
        "api-key": MURF_API_KEY,
        "Content-Type": "application/json",
    }
    data = {
        "voiceId": voice_id,
        "text": text,
        "locale": locale,
        "model": "falcon-2",
        "format": "MP3",
        "sampleRate": 24000,
        "channelType": "MONO",
    }

    try:
        response = requests.post(url, headers=headers, json=data, timeout=60)
    except requests.RequestException as e:
        os.unlink(temp_audio.name)
        raise RuntimeError("Speech service request failed.") from e

    if response.status_code != 200:
        os.unlink(temp_audio.name)
        raise RuntimeError("Speech service returned an error.")

    try:
        with open(temp_audio.name, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024):
                if chunk:
                    f.write(chunk)
    except Exception:
        try:
            os.unlink(temp_audio.name)
        except OSError:
            pass
        raise

    return temp_audio


def generate_description(place, answer_type, language):
    if answer_type not in PROMPTS:
        raise ValueError(
            f"Invalid answerType. Expected one of {list(PROMPTS)}"
        )
    prompt = PROMPTS[answer_type].format(place=place, language=language)
    client = _get_gemini_client()
    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=prompt,
    )
    if not response.text:
        raise RuntimeError("Empty response from language model.")
    return response.text


@app.route("/generate-audio-guide", methods=["POST"])
def generate_audio_guide():
    data = request.get_json(silent=True) or {}
    place = (data.get("place") or "").strip()
    answer_type = data.get("answerType")
    language = data.get("language")
    voice_id = data.get("voiceId")
    locale = data.get("locale")

    missing = [
        k
        for k, v in {
            "place": place,
            "answerType": answer_type,
            "language": language,
            "voiceId": voice_id,
            "locale": locale,
        }.items()
        if not v
    ]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    if not GEMINI_API_KEY or not MURF_API_KEY:
        return jsonify({"error": "Server is not configured. Missing API credentials."}), 500

    try:
        text_description = generate_description(place, answer_type, language)
        audio_path = generate_speech(text_description, voice_id, locale)
        try:
            with open(audio_path.name, "rb") as af:
                audio_bytes = af.read()
        finally:
            try:
                os.unlink(audio_path.name)
            except OSError:
                pass
        encoded_audio = base64.b64encode(audio_bytes).decode("utf-8")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        app.logger.exception("generate-audio-guide failed")
        return jsonify({"error": str(e)}), 502
    except Exception:
        app.logger.exception("generate-audio-guide failed")
        return jsonify({"error": "Generation failed."}), 502

    return jsonify(
        {
            "description": text_description,
            "audioBase64": encoded_audio,
        }
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "gemini_configured": bool(GEMINI_API_KEY),
            "murf_configured": bool(MURF_API_KEY),
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
