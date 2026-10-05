import { NextResponse } from "next/server";

export const runtime = "nodejs";
/** Vercel Hobby safe default; Pro can raise via dashboard. */
export const maxDuration = 60;

/**
 * Transcription runs in the browser → Gemini directly so Vercel's ~4.5 MB
 * request body limit never blocks audio. This route is kept as a health stub.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: "client-gemini",
    model: "gemini-3.5-transcribe",
  });
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "ট্রান্সক্রিপশন এখন ব্রাউজার থেকে সরাসরি Gemini-তে যায়। পেজ রিফ্রেশ করে আবার চেষ্টা করুন।",
    },
    { status: 410 },
  );
}
