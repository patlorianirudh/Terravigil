import { create } from 'zustand';
import type { ScanSession } from '../domain/types';

interface SessionState {
  activeSession: ScanSession | null;
  sessions: ScanSession[];
  isLoading: boolean;
  setActiveSession: (session: ScanSession | null) => void;
  setSessions: (sessions: ScanSession[]) => void;
  setLoading: (loading: boolean) => void;
}

export function savedMissionId(): string | null {
  try { return localStorage.getItem('terravigil.selectedMission'); } catch { return null; }
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSession: null,
  sessions: [],
  isLoading: false,
  setActiveSession: (session) => {
    try { if (session) localStorage.setItem('terravigil.selectedMission', session.id); } catch { /* Storage is optional. */ }
    set({ activeSession: session });
  },
  setSessions: (sessions) => {
    set({ sessions });
  },
  setLoading: (loading) => {
    set({ isLoading: loading });
  },
}));
