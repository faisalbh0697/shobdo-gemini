const STORAGE_KEY = "shobdo.openaiApiKey";

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
  const saved = localStorage.getItem(STORAGE_KEY) ?? "";
  if (saved === current) return;
  current = saved;
  emit();
}
