/** Gemini 3.5 Transcribe paid-tier estimates (Google pricing). */
export const AUDIO_TOKENS_PER_SECOND = 25;
/** Google's estimate for typical transcript density. */
export const OUTPUT_TOKENS_PER_MINUTE = 175;
export const INPUT_USD_PER_MILLION = 2;
export const OUTPUT_USD_PER_MILLION = 12;
export const BDT_PER_USD = 130;

export type CostEstimate = {
  durationSeconds: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usd: number;
  bdt: number;
};

export function estimateGeminiTranscribeCost(durationSeconds: number): CostEstimate | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const seconds = Math.ceil(durationSeconds);
  const minutes = seconds / 60;
  const inputTokens = Math.round(seconds * AUDIO_TOKENS_PER_SECOND);
  const outputTokens = Math.round(minutes * OUTPUT_TOKENS_PER_MINUTE);
  const totalTokens = inputTokens + outputTokens;

  const usd =
    (inputTokens / 1_000_000) * INPUT_USD_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_USD_PER_MILLION;
  const bdt = usd * BDT_PER_USD;

  return { durationSeconds: seconds, inputTokens, outputTokens, totalTokens, usd, bdt };
}

export function formatTokenCount(n: number): string {
  return new Intl.NumberFormat("bn-BD").format(n);
}

export function formatBdt(n: number): string {
  if (n < 0.01) return "০.০১-এর কম";
  return new Intl.NumberFormat("bn-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
