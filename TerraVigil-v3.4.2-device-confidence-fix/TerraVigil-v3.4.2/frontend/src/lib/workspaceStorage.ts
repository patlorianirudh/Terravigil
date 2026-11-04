import type { StateStorage } from 'zustand/middleware';

const fallback = new Map<string, string | null>();

/** Browser preferences are optional: a file URL or blocked storage must not prevent startup. */
export const workspaceStorage: StateStorage = {
  getItem(name) {
    if (fallback.has(name)) return fallback.get(name) ?? null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    fallback.set(name, value);
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Keep the current tab functional when storage access or its quota is unavailable.
    }
  },
  removeItem(name) {
    fallback.set(name, null);
    try {
      window.localStorage.removeItem(name);
    } catch {
      // The in-memory tombstone prevents an older stored value from returning in this tab.
    }
  },
};
