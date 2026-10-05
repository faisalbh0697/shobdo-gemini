import { NextResponse } from "next/server";
import {
  isAllowedAudio,
  MAX_AUDIO_BYTES,
  normalizeWords,
  type Transcript,
} from "@/lib/transcript";

export const runtime = "nodejs";
export const maxDuration = 60;

type OpenAIWord = { word?: string; start?: number; end?: number };

type OpenAIBody = {
  text?: string;
  language?: string;
  duration?: number;
  words?: OpenAIWord[];
  error?: { message?: string; code?: string };
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("অডিও ফাইলটা পড়া যায়নি। ২৫ MB-এর নিচে রাখুন।", 400);
  }

  const apiKeyRaw = form.get("apiKey");
  const file = form.get("file");
  const languageRaw = form.get("language");

  const apiKey = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
  if (!apiKey.startsWith("sk-") || apiKey.length < 20) {
    return jsonError("সঠিক OpenAI API key দিন। key সাধারণত sk- দিয়ে শুরু হয়।", 400);
  }

  if (!(file instanceof File) || file.size === 0) {
    return jsonError("একটা অডিও ফাইল দিন।", 400);
  }

  if (!isAllowedAudio(file.name)) {
    return jsonError(
      "এই ফরম্যাট চলবে না। mp3, wav, m4a, mp4, webm, ogg, বা flac দিন।",
      400,
    );
  }

  if (file.size > MAX_AUDIO_BYTES) {
    return jsonError("ফাইল ২৫ MB-এর বেশি। ছোট করে আবার দিন।", 400);
  }

  const language =
    typeof languageRaw === "string" && /^[a-z]{2}$/.test(languageRaw)
      ? languageRaw
      : "";

  const outbound = new FormData();
  outbound.append("file", file, file.name);
  outbound.append("model", "whisper-1");
  outbound.append("response_format", "verbose_json");
  outbound.append("timestamp_granularities[]", "word");
  outbound.append("temperature", "0");
  if (language) outbound.append("language", language);

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outbound,
    });
  } catch {
    return jsonError("OpenAI-তে পৌঁছানো যায়নি। নেটওয়ার্ক দেখে আবার চেষ্টা করুন।", 502);
  }

  const raw = await response.text();
  let data: OpenAIBody;
  try {
    data = JSON.parse(raw) as OpenAIBody;
  } catch {
    return jsonError("OpenAI থেকে অপ্রত্যাশিত উত্তর এসেছে।", 502);
  }

  if (!response.ok) {
    if (response.status === 401 || data.error?.code === "invalid_api_key") {
      return jsonError("API key কাজ করছে না। OpenAI ড্যাশবোর্ড থেকে key যাচাই করুন।", 401);
    }
    if (response.status === 429) {
      return jsonError("OpenAI রেট লিমিট। একটু পরে আবার চেষ্টা করুন।", 429);
    }
    return jsonError(data.error?.message ?? "ট্রান্সক্রিপশন হয়নি।", response.status);
  }

  const words = normalizeWords(data.words ?? []);
  const text = (data.text ?? "").trim() || words.map((word) => word.word).join(" ");

  const transcript: Transcript = {
    text,
    words,
    ...(data.language ? { language: data.language } : {}),
    ...(typeof data.duration === "number" ? { duration: data.duration } : {}),
  };

  return NextResponse.json(transcript);
}
