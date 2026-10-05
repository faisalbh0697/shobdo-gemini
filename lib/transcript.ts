export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
};

export type Transcript = {
  text: string;
  language?: string;
  duration?: number;
  words: TranscriptWord[];
};

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "oga",
  "ogg",
  "wav",
  "webm",
]);

export function audioExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

export function isAllowedAudio(name: string): boolean {
  return ALLOWED_EXTENSIONS.has(audioExtension(name));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.00";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

export function normalizeWords(
  words: Array<{ word?: string; start?: number; end?: number }>,
): TranscriptWord[] {
  const cleaned: TranscriptWord[] = [];
  for (const item of words) {
    const word = (item.word ?? "").replace(/^\s+/, "");
    if (!word) continue;
    const start = typeof item.start === "number" ? item.start : 0;
    const end = typeof item.end === "number" ? item.end : start;
    cleaned.push({ word, start, end: Math.max(end, start) });
  }
  return cleaned;
}

export function activeWordIndex(
  words: TranscriptWord[],
  currentTime: number,
): number {
  return words.findIndex((word, index) => {
    const next = words[index + 1];
    const end = next ? next.start : word.end + 0.05;
    return currentTime >= word.start && currentTime < end;
  });
}

export function transcriptToTimedText(transcript: Transcript): string {
  return transcript.words
    .map((word) => `${formatTimestamp(word.start)}\t${word.word}`)
    .join("\n");
}
