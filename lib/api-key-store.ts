const STORAGE_KEY = "shobdo.geminiApiKey";
const LEGACY_KEYS = ["shobdo.openaiApiKey", "shobdo.sarvamApiKey"] as const;

let current = "";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeApiKey(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getApiKey() {
  return current;
}

export function getServerApiKey() {
  return "";
}

export function setApiKey(next: string) {
  current = next;
  if (typeof window !== "undefined") {
    const trimmed = next.trim();
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  }
  emit();
}

export function loadApiKey() {
  if (typeof window === "undefined") return;
  let saved = localStorage.getItem(STORAGE_KEY) ?? "";
  if (!saved) {
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        saved = legacy;
        break;
      }
    }
  }
  if (saved === current) return;
  current = saved;
  emit();
}
