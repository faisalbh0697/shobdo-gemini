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

/** Collapse elongated glyph runs Whisper often invents (স্যারেরেরের → স্যারের). */
function collapseCharRuns(word: string): string {
  return word.replace(/([\p{L}\p{M}\p{N}])\1{2,}/gu, "$1$1");
}

export function normalizeWords(
  words: Array<{ word?: string; start?: number; end?: number }>,
): TranscriptWord[] {
  const cleaned: TranscriptWord[] = [];
  for (const item of words) {
    const word = collapseCharRuns((item.word ?? "").replace(/^\s+/, ""));
    if (!word) continue;
    const start = typeof item.start === "number" ? item.start : 0;
    const end = typeof item.end === "number" ? item.end : start;
    cleaned.push({ word, start, end: Math.max(end, start) });
  }
  return collapseHallucinatedWords(cleaned);
}

/**
 * Whisper often loops the same word/phrase on silence or chunk edges.
 * Keep at most `maxRepeat` consecutive identical words, and collapse phrase loops.
 */
export function collapseHallucinatedWords(
  words: TranscriptWord[],
  options?: { maxWordRepeat?: number; maxPhraseLen?: number; minPhraseRepeats?: number },
): TranscriptWord[] {
  const maxWordRepeat = options?.maxWordRepeat ?? 2;
  const maxPhraseLen = options?.maxPhraseLen ?? 10;
  const minPhraseRepeats = options?.minPhraseRepeats ?? 3;

  const afterWords: TranscriptWord[] = [];
  for (const word of words) {
    let run = 1;
    for (let i = afterWords.length - 1; i >= 0; i -= 1) {
      if (afterWords[i]!.word !== word.word) break;
      run += 1;
    }
    if (run > maxWordRepeat) continue;
    afterWords.push(word);
  }

  return collapsePhraseLoops(afterWords, maxPhraseLen, minPhraseRepeats);
}

function collapsePhraseLoops(
  words: TranscriptWord[],
  maxPhraseLen: number,
  minRepeats: number,
): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let i = 0;
  while (i < words.length) {
    let collapsed = false;
    const remaining = words.length - i;
    const maxLen = Math.min(maxPhraseLen, Math.floor(remaining / minRepeats));

    for (let len = maxLen; len >= 1; len -= 1) {
      if (!phraseRepeatsAt(words, i, len, minRepeats)) continue;
      let repeats = 0;
      while (
        i + (repeats + 1) * len <= words.length &&
        phraseEquals(words, i, i + repeats * len, len)
      ) {
        repeats += 1;
      }
      for (let k = 0; k < len; k += 1) out.push(words[i + k]!);
      i += repeats * len;
      collapsed = true;
      break;
    }

    if (!collapsed) {
      out.push(words[i]!);
      i += 1;
    }
  }
  return out;
}

function phraseEquals(
  words: TranscriptWord[],
  a: number,
  b: number,
  len: number,
): boolean {
  for (let k = 0; k < len; k += 1) {
    if (words[a + k]?.word !== words[b + k]?.word) return false;
  }
  return true;
}

function phraseRepeatsAt(
  words: TranscriptWord[],
  start: number,
  len: number,
  minRepeats: number,
): boolean {
  if (start + len * minRepeats > words.length) return false;
  for (let r = 1; r < minRepeats; r += 1) {
    if (!phraseEquals(words, start, start + r * len, len)) return false;
  }
  return true;
}

export function wordsToText(words: TranscriptWord[]): string {
  return words.map((w) => w.word).join(" ").replace(/\s+/g, " ").trim();
}

export function cleanTranscript(transcript: Transcript): Transcript {
  const words = collapseHallucinatedWords(
    transcript.words
      .map((item) => {
        const word = collapseCharRuns(item.word.replace(/^\s+/, ""));
        return {
          word,
          start: item.start,
          end: Math.max(item.end, item.start),
        };
      })
      .filter((item) => item.word.length > 0),
  );
  return {
    ...transcript,
    words,
    text: wordsToText(words) || transcript.text.trim(),
  };
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

const OVERLAP_DEDUPE_WINDOW = 0.35;

export function mergeTranscripts(
  parts: Array<{ transcript: Transcript; offsetSeconds: number }>,
): Transcript {
  if (parts.length === 0) {
    return { text: "", words: [] };
  }
  if (parts.length === 1) {
    return cleanTranscript(parts[0]!.transcript);
  }

  const words: TranscriptWord[] = [];
  let language: string | undefined;
  let duration = 0;

  for (const part of parts) {
    const transcript = cleanTranscript(part.transcript);
    const { offsetSeconds } = part;
    if (transcript.language && !language) language = transcript.language;
    if (typeof transcript.duration === "number") {
      duration = Math.max(duration, offsetSeconds + transcript.duration);
    }

    for (const word of transcript.words) {
      const start = word.start + offsetSeconds;
      const end = word.end + offsetSeconds;
      const prev = words.at(-1);
      const isDuplicate =
        !!prev &&
        prev.word === word.word &&
        Math.abs(prev.start - start) <= OVERLAP_DEDUPE_WINDOW;
      if (isDuplicate) continue;
      words.push({ word: word.word, start, end: Math.max(end, start) });
    }
  }

  const collapsed = collapseHallucinatedWords(words);
  if (collapsed.length > 0) {
    const last = collapsed.at(-1)!;
    duration = Math.max(duration, last.end);
  }

  return {
    text: wordsToText(collapsed),
    words: collapsed,
    ...(language ? { language } : {}),
    ...(duration > 0 ? { duration } : {}),
  };
}

/**
 * OpenAI's hosted whisper-1 rejects some ISO codes (notably `bn`) even though
 * open-source Whisper knows them. Only forward codes the API accepts.
 * @see https://platform.openai.com/docs/guides/speech-to-text
 */
const OPENAI_LANGUAGE_CODES = new Set([
  "af",
  "ar",
  "hy",
  "az",
  "be",
  "bs",
  "bg",
  "ca",
  "zh",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "et",
  "fi",
  "fr",
  "gl",
  "de",
  "el",
  "he",
  "hi",
  "hu",
  "is",
  "id",
  "it",
  "ja",
  "kn",
  "kk",
  "ko",
  "lv",
  "lt",
  "mk",
  "ms",
  "mr",
  "mi",
  "ne",
  "no",
  "fa",
  "pl",
  "pt",
  "ro",
  "ru",
  "sr",
  "sk",
  "sl",
  "es",
  "sw",
  "sv",
  "tl",
  "ta",
  "th",
  "tr",
  "uk",
  "ur",
  "vi",
  "cy",
]);

/** Returns a code safe to send as Whisper `language`, or "" to omit. */
export function openaiLanguageParam(language: string): string {
  if (!language || !/^[a-z]{2}$/.test(language)) return "";
  return OPENAI_LANGUAGE_CODES.has(language) ? language : "";
}

/** Seed / carry prompt so Whisper keeps language & style across chunks. */
export function languageSeedPrompt(language: string): string {
  if (language === "bn") {
    // API won't accept language=bn — prompt is the only way to bias Bangla.
    return "এটি বাংলা ভাষার কথোপকথন। সঠিক বাংলা অক্ষরে লিখুন। ইংরেজি শব্দ থাকলেও বাক্য বাংলায় রাখুন।";
  }
  if (language === "en") {
    return "This is spoken English. Transcribe clearly in English.";
  }
  if (language === "hi") {
    return "यह हिंदी भाषण है। सही देवनागरी में लिखें।";
  }
  return "";
}

export function continuationPrompt(previousText: string, language: string): string {
  const seed = languageSeedPrompt(language);
  const tail = previousText.replace(/\s+/g, " ").trim().slice(-600);
  if (!seed && !tail) return "";
  if (!tail) return seed;
  if (!seed) return tail;
  return `${seed} ${tail}`.slice(-800);
}
