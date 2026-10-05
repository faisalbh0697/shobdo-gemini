import type { TranscriptWord } from "@/lib/transcript";

/** Word timestamps allowed up to 30 min; keep a safety margin. */
export const GEMINI_MAX_DURATION_SECONDS = 25 * 60;
export const GEMINI_CHUNK_SECONDS = 10 * 60;

const LANGUAGE_TO_BCP47: Record<string, string> = {
  bn: "bn-BD",
  en: "en-US",
  hi: "hi-IN",
  ar: "ar-EG",
  es: "es-US",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "cmn-Hans-CN",
};

export function toGeminiLanguage(code: string): string | null {
  if (!code) return null;
  return LANGUAGE_TO_BCP47[code] ?? null;
}

export function mimeFromFilename(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mp3",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
    m4a: "audio/m4a",
    mp4: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
  };
  return map[ext] ?? "audio/wav";
}

export function parseOffsetSeconds(offset: string | undefined): number {
  if (!offset) return 0;
  const match = String(offset).match(/([0-9]*\.?[0-9]+)/);
  return match ? Number(match[1]) : 0;
}

type GeminiWord = {
  word?: string;
  startOffset?: string;
  endOffset?: string;
  start_offset?: string;
  end_offset?: string;
};

type GeminiPart = {
  text?: string;
  audioTranscription?: {
    speakerLabel?: string;
    words?: GeminiWord[];
  };
  audio_transcription?: {
    speaker_label?: string;
    words?: GeminiWord[];
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
  error?: { message?: string; status?: string; code?: number };
};

export function parseGeminiTranscript(data: GeminiResponse): {
  text: string;
  words: TranscriptWord[];
} {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const textParts: string[] = [];
  const words: TranscriptWord[] = [];

  for (const part of parts) {
    if (part.text?.trim()) textParts.push(part.text.trim());
    const transcription = part.audioTranscription ?? part.audio_transcription;
    for (const item of transcription?.words ?? []) {
      const word = (item.word ?? "").trim();
      if (!word) continue;
      const start = parseOffsetSeconds(item.startOffset ?? item.start_offset);
      const end = parseOffsetSeconds(item.endOffset ?? item.end_offset);
      words.push({ word, start, end: Math.max(end, start) });
    }
  }

  const text =
    textParts.join(" ").trim() || words.map((w) => w.word).join(" ").trim();

  return { text, words };
}
