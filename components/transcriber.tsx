"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  activeWordIndex,
  formatBytes,
  formatTimestamp,
  isAllowedAudio,
  mergeTranscripts,
  transcriptToTimedText,
  type Transcript,
} from "@/lib/transcript";
import { prepareAudioChunks } from "@/lib/audio-chunks";
import { GEMINI_CHUNK_SECONDS, GEMINI_MAX_DURATION_SECONDS } from "@/lib/gemini";
import { transcribeChunkWithGemini } from "@/lib/gemini-client";
import {
  estimateGeminiTranscribeCost,
  formatBdt,
  formatTokenCount,
} from "@/lib/gemini-cost";
import {
  getApiKey,
  getServerApiKey,
  loadApiKey,
  setApiKey,
  subscribeApiKey,
} from "@/lib/api-key-store";
import { cn } from "cn";

const LANGUAGES = [
  { value: "", label: "অটো ডিটেক্ট" },
  { value: "bn", label: "বাংলা" },
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
  { value: "ur", label: "اردو" },
  { value: "ar", label: "العربية" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh", label: "中文" },
] as const;

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

type View = "reading" | "list";
type CopyKind = "text" | "timed";

const fieldClass =
  "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function Transcriber() {
  const apiKey = useSyncExternalStore(subscribeApiKey, getApiKey, getServerApiKey);
  const [showKey, setShowKey] = useState(false);
  const [language, setLanguage] = useState("bn");
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [chunkProgress, setChunkProgress] = useState<{
    total: number;
    done: number;
    current: number;
  } | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [view, setView] = useState<View>("reading");
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const audioRef = useRef<HTMLAudioElement>(null);
  const activeWordRef = useRef<HTMLButtonElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const requestId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadApiKey();
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const activeIndex = useMemo(
    () => (transcript ? activeWordIndex(transcript.words, currentTime) : -1),
    [transcript, currentTime],
  );

  useEffect(() => {
    activeWordRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, view]);

  function pickFile(next: File | null) {
    if (!next) return;
    if (!isAllowedAudio(next.name)) {
      setError("এই ফরম্যাট চলবে না। mp3, wav, m4a, mp4, webm, ogg, বা flac দিন।");
      setStatus("error");
      return;
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(next);
    audioUrlRef.current = url;
    setFile(next);
    setAudioUrl(url);
    setAudioDuration(null);
    setTranscript(null);
    setCurrentTime(0);
    setError(null);
    setProgress(null);
    setChunkProgress(null);
    setStatus("idle");
  }

  const costEstimate = useMemo(
    () => (audioDuration != null ? estimateGeminiTranscribeCost(audioDuration) : null),
    [audioDuration],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("আগে একটা অডিও ফাইল দিন।");
      setStatus("error");
      return;
    }
    if (apiKey.trim().length < 20) {
      setError("Gemini API key দিন (aistudio.google.com থেকে)।");
      setStatus("error");
      return;
    }

    const id = ++requestId.current;
    setStatus("loading");
    setError(null);
    setTranscript(null);
    setCurrentTime(0);
    setChunkProgress(null);
    setProgress("অডিও প্রস্তুত করা হচ্ছে…");

    try {
      const chunks = await prepareAudioChunks(file, {
        chunkSeconds: GEMINI_CHUNK_SECONDS,
        maxDurationSeconds: GEMINI_MAX_DURATION_SECONDS,
        // Browser uploads straight to Gemini — not limited by Vercel body size.
        maxBytes: 200 * 1024 * 1024,
      });
      if (id !== requestId.current) return;

      const parts: Array<{ transcript: Transcript; offsetSeconds: number }> = [];
      setChunkProgress({ total: chunks.length, done: 0, current: chunks.length > 0 ? 1 : 0 });

      for (const chunk of chunks) {
        if (id !== requestId.current) return;
        setChunkProgress({
          total: chunks.length,
          done: parts.length,
          current: chunk.index + 1,
        });
        setProgress(
          chunks.length > 1
            ? `চাঙ্ক ${chunk.index + 1}/${chunk.total} ট্রান্সক্রাইব হচ্ছে…`
            : "অডিও শুনে শব্দ আলাদা করা হচ্ছে…",
        );

        try {
          const payload = await transcribeChunkWithGemini({
            apiKey: apiKey.trim(),
            blob: chunk.blob,
            filename: chunk.filename,
            language: language || undefined,
          });
          if (id !== requestId.current) return;
          parts.push({ transcript: payload, offsetSeconds: chunk.offsetSeconds });
        } catch (chunkErr) {
          if (id !== requestId.current) return;
          const message =
            chunkErr instanceof Error ? chunkErr.message : "ট্রান্সক্রিপশন হয়নি।";
          setStatus("error");
          setProgress(null);
          setChunkProgress(null);
          setError(
            chunks.length > 1
              ? `চাঙ্ক ${chunk.index + 1}/${chunk.total}: ${message}`
              : message,
          );
          return;
        }

        const partial = mergeTranscripts(parts);
        setTranscript(partial);
        setChunkProgress({
          total: chunks.length,
          done: parts.length,
          current: chunk.index + 1 < chunks.length ? chunk.index + 2 : 0,
        });
        setProgress(
          parts.length < chunks.length
            ? `চাঙ্ক ${parts.length}/${chunks.length} রেডি · পরেরটা চলছে…`
            : `সব ${chunks.length}টা চাঙ্ক রেডি · ফাইনাল মার্জ হচ্ছে…`,
        );
      }

      if (id !== requestId.current) return;
      setTranscript(mergeTranscripts(parts));
      setCurrentTime(0);
      setProgress(null);
      setChunkProgress(null);
      setStatus("done");
    } catch (err) {
      if (id !== requestId.current) return;
      setStatus("error");
      setProgress(null);
      setChunkProgress(null);
      setError(err instanceof Error ? err.message : "নেটওয়ার্ক সমস্যা। আবার চেষ্টা করুন।");
    }
  }

  function seek(start: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = start;
    setCurrentTime(start);
    void audio.play();
  }

  async function copy(kind: CopyKind) {
    if (!transcript) return;
    const value = kind === "text" ? transcript.text : transcriptToTimedText(transcript);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1600);
    } catch {
      setError("কপি করা যায়নি। ব্রাউজার ক্লিপবোর্ড ব্লক করেছে।");
      setStatus("error");
    }
  }

  function download(kind: "txt" | "json") {
    if (!transcript || !file) return;
    const base = file.name.replace(/\.[^.]+$/, "") || "transcript";
    const contents =
      kind === "json" ? JSON.stringify(transcript, null, 2) : transcriptToTimedText(transcript);
    const blob = new Blob([contents], {
      type: kind === "json" ? "application/json" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${base}.words.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const wordCount = transcript?.words.length ?? 0;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
      <aside className="md:sticky md:top-6 md:self-start">
        <Card>
          <CardHeader>
            <h2 className="text-base leading-snug font-medium">অডিও</h2>
            <CardDescription>
              Gemini 3.5 Transcribe — native word timestamps। key শুধু এই ব্রাউজারে থাকে।
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="api-key">Gemini API key</Label>
                <div className="relative">
                  <Input
                    id="api-key"
                    className={cn("h-10 pr-10", !showKey && apiKey.length > 0 && "secret-mask")}
                    type="text"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="AIza..."
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? "key লুকান" : "key দেখান"}
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">ফাইল</span>
                {file && audioUrl ? (
                  <div
                    className="rounded-xl border-2 border-emerald-600 bg-stone-900 px-4 py-4 text-stone-50 shadow-sm"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                        <Check className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold tracking-wide text-emerald-300 uppercase">
                          ফাইল লোড হয়েছে
                        </p>
                        <p className="mt-0.5 break-all text-sm font-medium" title={file.name}>
                          {file.name}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">{formatBytes(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        className="rounded-md p-1 text-stone-400 hover:bg-white/10 hover:text-white"
                        aria-label="ফাইল সরান"
                        onClick={() => {
                          if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
                          audioUrlRef.current = null;
                          setFile(null);
                          setAudioUrl(null);
                          setAudioDuration(null);
                          setTranscript(null);
                          setCurrentTime(0);
                          setError(null);
                          setProgress(null);
                          setChunkProgress(null);
                          setStatus("idle");
                        }}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <audio
                      ref={audioRef}
                      src={audioUrl}
                      controls
                      preload="metadata"
                      className="mt-3 w-full"
                      onLoadedMetadata={() => {
                        const d = audioRef.current?.duration;
                        setAudioDuration(
                          typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null,
                        );
                      }}
                      onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
                      onSeeked={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
                      onPlay={() => {
                        if (audioRef.current) audioRef.current.playbackRate = speed;
                      }}
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-lg bg-white px-3 text-xs font-medium text-stone-900"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        অন্য ফাইল
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragging(false);
                      pickFile(event.dataTransfer.files[0] ?? null);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
                      dragging
                        ? "border-foreground bg-muted"
                        : "border-border bg-muted/40 hover:bg-muted",
                    )}
                  >
                    <Upload className="size-5 text-muted-foreground" />
                    <span className="text-sm font-medium">অডিও ছাড়ুন, বা ক্লিক করে নিন</span>
                    <span className="text-xs leading-5 text-muted-foreground">
                      mp3, wav, m4a, mp4, webm, ogg, flac
                    </span>
                    <span className="text-xs text-muted-foreground">
                      লম্বা ফাইল চাঙ্ক করে পাঠানো হবে
                    </span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  id="audio-file"
                  className="sr-only"
                  type="file"
                  accept="audio/*,video/mp4,video/webm,.mp3,.wav,.m4a,.mp4,.webm,.ogg,.flac,.mpeg"
                  onChange={(event) => {
                    pickFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="language">ভাষা</Label>
                <select
                  id="language"
                  className={fieldClass}
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  {LANGUAGES.map((item) => (
                    <option key={item.value || "auto"} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  বাংলা অডিওতে “বাংলা” সিলেক্ট রাখুন — `bn-BD` হিসেবে Gemini-তে যায়।
                </p>
              </div>

              <Button type="submit" size="lg" className="h-10 w-full" disabled={status === "loading"}>
                {status === "loading" ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    শুনছি…
                  </>
                ) : (
                  "শব্দে শব্দে লিখুন"
                )}
              </Button>

              {file && costEstimate ? (
                <p className="rounded-lg bg-muted/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  আনুমানিক খরচ ·{" "}
                  <span className="font-medium text-foreground">
                    {formatTokenCount(costEstimate.totalTokens)} টোকেন
                  </span>
                  {" · "}
                  <span className="font-medium text-foreground">
                    ৳{formatBdt(costEstimate.bdt)}
                  </span>
                  <span className="mt-0.5 block text-[11px] opacity-80">
                    ইনপুট {formatTokenCount(costEstimate.inputTokens)} + আউটপুট{" "}
                    {formatTokenCount(costEstimate.outputTokens)} · $
                    {costEstimate.usd.toFixed(4)} × ১৩০৳
                  </span>
                </p>
              ) : file ? (
                <p className="text-xs text-muted-foreground">অডিও দৈর্ঘ্য পড়া হচ্ছে…</p>
              ) : null}

              {error ? (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </aside>

      <section className="flex min-w-0 flex-col gap-4" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium tracking-tight">শব্দগুলো</h2>
            <p className="text-sm text-muted-foreground">
              {status === "loading" && chunkProgress
                ? `${chunkProgress.done}/${chunkProgress.total} চাঙ্ক রেডি${wordCount ? ` · ${wordCount}টা শব্দ এখনো পর্যন্ত` : ""}`
                : transcript
                  ? `${wordCount}টা শব্দ${transcript.language ? ` · ${transcript.language}` : ""}`
                  : "একটা শব্দে ক্লিক করলে অডিও সেখান থেকে বাজবে।"}
            </p>
          </div>
          {transcript && wordCount > 0 ? (
            <div className="inline-flex rounded-lg bg-muted p-0.5">
              {(
                [
                  ["reading", "পড়া"],
                  ["list", "তালিকা"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setView(value)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm",
                    view === value ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {file ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <Check className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-all font-medium">{file.name}</span>
            <span className="shrink-0 text-xs text-emerald-800/70">{formatBytes(file.size)}</span>
            <div className="flex w-full items-center gap-1 sm:ml-auto sm:w-auto">
              <span className="mr-auto font-mono text-xs text-emerald-800/70 sm:mr-2">
                {formatTimestamp(currentTime)}
                {transcript?.duration ? ` / ${formatTimestamp(transcript.duration)}` : ""}
              </span>
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSpeed(value);
                    if (audioRef.current) audioRef.current.playbackRate = value;
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 font-mono text-xs",
                    speed === value
                      ? "bg-emerald-900 text-white"
                      : "text-emerald-800/70 hover:bg-emerald-100",
                  )}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="min-h-80 rounded-xl bg-card ring-1 ring-foreground/10">
          {status === "loading" ? (
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2">
                <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                <p className="text-sm font-medium">
                  {progress ?? "অডিও শুনে শব্দ আলাদা করা হচ্ছে"}
                </p>
              </div>
              {chunkProgress && chunkProgress.total > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: chunkProgress.total }, (_, index) => {
                    const n = index + 1;
                    const done = n <= chunkProgress.done;
                    const current = n === chunkProgress.current;
                    return (
                      <span
                        key={n}
                        className={cn(
                          "rounded-md px-2 py-0.5 font-mono text-xs",
                          done && "bg-foreground text-background",
                          current && !done && "bg-muted text-foreground ring-1 ring-foreground/20",
                          !done && !current && "bg-muted/50 text-muted-foreground",
                        )}
                      >
                        {done ? `✓ ${n}` : current ? `… ${n}` : `${n}`}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              {!transcript ? (
                <p className="text-xs text-muted-foreground">
                  যে চাঙ্ক রেডি হবে সেটা এখানে দেখা যাবে — সব শেষ হলে পুরোটা একসাথে থাকবে।
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  নিচে যেটা দেখছেন সেটা এখনো পর্যন্ত রেডি অংশ। বাকি চাঙ্ক এলে আপডেট হবে।
                </p>
              )}
            </div>
          ) : null}

          {status !== "loading" && !transcript ? (
            <div className="flex min-h-80 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium">এখনো কোনো ট্রান্সক্রিপ্ট নেই</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                বাঁ দিক থেকে অডিও দিন। প্রতিটা শব্দ আলাদা চিপ হয়ে আসবে, সাথে কখন বলা হয়েছে।
              </p>
            </div>
          ) : null}

          {status === "loading" && !transcript ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-muted-foreground">প্রথম চাঙ্কের জন্য অপেক্ষা…</p>
            </div>
          ) : null}

          {transcript && wordCount === 0 ? (
            <div className="flex min-h-80 flex-col gap-3 p-6">
              <p className="text-sm text-amber-800">
                লেখা এসেছে, কিন্তু শব্দ-লেভেল সময় আসেনি। আরেকবার চেষ্টা করুন, বা ভাষা অটোতে রাখুন।
              </p>
              {transcript.text ? (
                <p className="text-base leading-8">{transcript.text}</p>
              ) : (
                <p className="text-sm text-muted-foreground">এই অডিওতে কোনো কথা শোনা যায়নি।</p>
              )}
            </div>
          ) : null}

          {transcript && wordCount > 0 && view === "reading" ? (
            <div className="flex flex-wrap content-start gap-x-1 gap-y-1 p-4 sm:p-6">
              {transcript.words.map((word, index) => {
                const active = index === activeIndex;
                const played = activeIndex > index;
                return (
                  <button
                    key={`${word.start}-${index}`}
                    ref={active ? activeWordRef : undefined}
                    type="button"
                    title={`${formatTimestamp(word.start)} – ${formatTimestamp(word.end)}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => seek(word.start)}
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-left text-[1.05rem] leading-8 transition-colors",
                      active && "bg-stone-900 text-white",
                      !active && played && "text-stone-400 hover:bg-stone-100 hover:text-stone-900",
                      !active && !played && "hover:bg-stone-100",
                    )}
                  >
                    {word.word}
                  </button>
                );
              })}
            </div>
          ) : null}

          {transcript && wordCount > 0 && view === "list" ? (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">শব্দ</th>
                    <th className="px-4 py-2 font-medium">শুরু</th>
                    <th className="px-4 py-2 font-medium">শেষ</th>
                  </tr>
                </thead>
                <tbody>
                  {transcript.words.map((word, index) => {
                    const active = index === activeIndex;
                    return (
                      <tr key={`${word.start}-${index}`} className={cn("border-b last:border-0", active && "bg-stone-900 text-white")}>
                        <td className="px-4 py-2 font-mono text-xs">{index + 1}</td>
                        <td className="px-4 py-2">
                          <button
                            ref={active ? activeWordRef : undefined}
                            type="button"
                            onClick={() => seek(word.start)}
                            className="text-left"
                          >
                            {word.word}
                          </button>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{formatTimestamp(word.start)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{formatTimestamp(word.end)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {transcript && (transcript.text || wordCount > 0) ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => copy("text")} disabled={!transcript.text}>
              {copied === "text" ? <Check /> : <Copy />}
              পুরো লেখা
            </Button>
            <Button type="button" variant="outline" onClick={() => copy("timed")} disabled={wordCount === 0}>
              {copied === "timed" ? <Check /> : <Copy />}
              সময়সহ
            </Button>
            <Button type="button" variant="outline" onClick={() => download("txt")} disabled={wordCount === 0}>
              <Download />
              .txt
            </Button>
            <Button type="button" variant="outline" onClick={() => download("json")}>
              <Download />
              .json
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
