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
  MAX_AUDIO_BYTES,
  transcriptToTimedText,
  type Transcript,
} from "@/lib/transcript";
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
  const [language, setLanguage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
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
    if (next.size > MAX_AUDIO_BYTES) {
      setError("ফাইল ২৫ MB-এর বেশি। ছোট করে আবার দিন।");
      setStatus("error");
      return;
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(next);
    audioUrlRef.current = url;
    setFile(next);
    setAudioUrl(url);
    setTranscript(null);
    setCurrentTime(0);
    setError(null);
    setStatus("idle");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("আগে একটা অডিও ফাইল দিন।");
      setStatus("error");
      return;
    }
    if (!apiKey.trim().startsWith("sk-")) {
      setError("OpenAI API key দিন। key সাধারণত sk- দিয়ে শুরু হয়।");
      setStatus("error");
      return;
    }

    const id = ++requestId.current;
    setStatus("loading");
    setError(null);

    const body = new FormData();
    body.append("file", file);
    body.append("apiKey", apiKey.trim());
    if (language) body.append("language", language);

    try {
      const response = await fetch("/api/transcribe", { method: "POST", body });
      const payload = (await response.json()) as Transcript & { error?: string };
      if (id !== requestId.current) return;
      if (!response.ok) {
        setStatus("error");
        setError(payload.error ?? "ট্রান্সক্রিপশন হয়নি।");
        return;
      }
      setTranscript(payload);
      setCurrentTime(0);
      setStatus("done");
    } catch {
      if (id !== requestId.current) return;
      setStatus("error");
      setError("নেটওয়ার্ক সমস্যা। আবার চেষ্টা করুন।");
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
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <h2 className="text-base leading-snug font-medium">অডিও</h2>
            <CardDescription>
              key এই ব্রাউজারে থাকে। সার্ভারে সেভ হয় না — শুধু OpenAI-তে পাঠানো হয়।
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="api-key">OpenAI API key</Label>
                <div className="relative">
                  <Input
                    id="api-key"
                    className={cn("h-10 pr-10", !showKey && apiKey.length > 0 && "secret-mask")}
                    type="text"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="sk-..."
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
                <Label htmlFor="audio-file">ফাইল</Label>
                <label
                  htmlFor="audio-file"
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
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
                    dragging ? "border-foreground bg-muted" : "border-border bg-muted/40 hover:bg-muted",
                  )}
                >
                  <Upload className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {file ? file.name : "অডিও ছাড়ুন, বা ক্লিক করে নিন"}
                  </span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {file ? formatBytes(file.size) : "mp3, wav, m4a, mp4, webm, ogg, flac"}
                  </span>
                  {file ? null : (
                    <span className="text-xs text-muted-foreground">সর্বোচ্চ ২৫ MB</span>
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
                </label>
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
              {transcript
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

        {audioUrl ? (
          <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              preload="metadata"
              className="w-full"
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
              onSeeked={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
              onPlay={() => {
                if (audioRef.current) audioRef.current.playbackRate = speed;
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {formatTimestamp(currentTime)}
                {transcript?.duration ? ` / ${formatTimestamp(transcript.duration)}` : ""}
              </span>
              <div className="ml-auto flex items-center gap-1">
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
                      speed === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="min-h-80 rounded-xl bg-card ring-1 ring-foreground/10">
          {status === "loading" ? (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 text-center">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">অডিও শুনে শব্দ আলাদা করা হচ্ছে</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                লম্বা ফাইলে একটু সময় লাগে। পেজটা খোলা রাখুন।
              </p>
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

          {status !== "loading" && transcript && wordCount === 0 ? (
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

          {status !== "loading" && transcript && wordCount > 0 && view === "reading" ? (
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

          {status !== "loading" && transcript && wordCount > 0 && view === "list" ? (
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
