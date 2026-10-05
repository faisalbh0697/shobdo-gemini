import {
  mimeFromFilename,
  parseGeminiTranscript,
  toGeminiLanguage,
} from "@/lib/gemini";
import {
  normalizeWords,
  wordsToText,
  type Transcript,
} from "@/lib/transcript";

const GEMINI_MODEL = "gemini-3.5-transcribe";
const BASE = "https://generativelanguage.googleapis.com";

type UploadedFile = {
  uri: string;
  mimeType: string;
  name: string;
};

function mapGeminiError(status: number, message: string): string {
  if (status === 401 || status === 403 || /API key/i.test(message)) {
    return "API key কাজ করছে না। Google AI Studio থেকে key যাচাই করুন।";
  }
  if (status === 429) {
    return "Gemini রেট লিমিট। একটু পরে আবার চেষ্টা করুন।";
  }
  return message || "ট্রান্সক্রিপশন হয়নি।";
}

async function uploadGeminiFile(
  apiKey: string,
  blob: Blob,
  filename: string,
): Promise<UploadedFile> {
  const mimeType = mimeFromFilename(filename);

  const start = await fetch(
    `${BASE}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(blob.size),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: filename } }),
    },
  );

  if (!start.ok) {
    const errText = await start.text();
    throw new Error(mapGeminiError(start.status, errText.slice(0, 200)));
  }

  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini upload URL পাওয়া যায়নি।");
  }

  const finish = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(blob.size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: blob,
  });

  const raw = await finish.text();
  let data: {
    file?: { uri?: string; name?: string; mimeType?: string };
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error("Gemini file upload response invalid.");
  }

  if (!finish.ok || !data.file?.uri) {
    throw new Error(
      mapGeminiError(finish.status, data.error?.message ?? "Gemini-তে ফাইল আপলোড হয়নি।"),
    );
  }

  return {
    uri: data.file.uri,
    mimeType: data.file.mimeType ?? mimeType,
    name: data.file.name ?? "",
  };
}

async function deleteGeminiFile(apiKey: string, name: string) {
  if (!name) return;
  try {
    await fetch(`${BASE}/v1beta/${name}?key=${encodeURIComponent(apiKey)}`, {
      method: "DELETE",
    });
  } catch {
    // best-effort cleanup
  }
}

/** Browser → Gemini directly (avoids Vercel 4.5 MB body limit). */
export async function transcribeChunkWithGemini(options: {
  apiKey: string;
  blob: Blob;
  filename: string;
  language?: string;
}): Promise<Transcript> {
  const { apiKey, blob, filename, language } = options;
  const languageCode = language ? toGeminiLanguage(language) : null;
  let uploadedName = "";

  try {
    const uploaded = await uploadGeminiFile(apiKey, blob, filename);
    uploadedName = uploaded.name;

    const response = await fetch(
      `${BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  fileData: {
                    fileUri: uploaded.uri,
                    mimeType: uploaded.mimeType,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            audioTranscriptionConfig: {
              wordTimestamp: true,
              mode: "VERBATIM",
              languageCodes: languageCode ? [languageCode] : [],
            },
          },
        }),
      },
    );

    const raw = await response.text();
    let data: Parameters<typeof parseGeminiTranscript>[0] & {
      error?: { message?: string };
    };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      throw new Error("Gemini থেকে অপ্রত্যাশিত উত্তর এসেছে।");
    }

    if (!response.ok || data.error) {
      throw new Error(mapGeminiError(response.status, data.error?.message ?? ""));
    }

    const parsed = parseGeminiTranscript(data);
    const words = normalizeWords(parsed.words);
    const text = parsed.text || wordsToText(words);
    const duration = words.length > 0 ? words.at(-1)!.end : undefined;

    return {
      text,
      words,
      ...(languageCode ? { language: languageCode } : {}),
      ...(typeof duration === "number" ? { duration } : {}),
    };
  } finally {
    if (uploadedName) {
      await deleteGeminiFile(apiKey, uploadedName);
    }
  }
}
