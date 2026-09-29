'use client';

import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';

type ThemeMode = 'dark' | 'light';

interface UIState {
  sidebarCollapsed: boolean;
  theme: ThemeMode;
}

type UIAction =
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR'; payload: boolean }
  | { type: 'SET_THEME'; payload: ThemeMode };

const initialState: UIState = {
  sidebarCollapsed: false,
  theme: 'light',
};

function reducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'SET_SIDEBAR':
      return { ...state, sidebarCollapsed: action.payload };
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    default:
      return state;
  }
}

const UIStateContext = createContext<{ state: UIState; dispatch: React.Dispatch<UIAction> } | null>(null);

export function UIStateProvider({ children }: { children: React.ReactNode }) {
  // Always start at the 'light' default (matching SSR output) — reading localStorage
  // in a lazy reducer initializer would run eagerly during client hydration but not
  // during the server render, causing a server/client markup mismatch (React then
  // discards the server HTML for the whole document). The real theme is restored
  // client-side, after hydration, in the mount-only effect below.
  const [state, dispatch] = useReducer(reducer, initialState);
  const skipNextApply = useRef(true);

  // Restore theme from localStorage once, client-side only, after hydration.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('theme') as ThemeMode | null;
      const theme: ThemeMode = saved === 'dark' ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', theme === 'dark');
      if (theme !== initialState.theme) dispatch({ type: 'SET_THEME', payload: theme });
    } catch {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Apply dark class and persist theme on every subsequent change. The mount-time
  // commit is skipped here — the restore effect above already applied it — so this
  // doesn't race the restore effect and stomp a saved 'dark' preference back to
  // 'light' before it's ever read.
  useEffect(() => {
    if (skipNextApply.current) { skipNextApply.current = false; return; }
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    try { localStorage.setItem('theme', state.theme); } catch { /* ignore */ }
  }, [state.theme]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <UIStateContext.Provider value={value}>{children}</UIStateContext.Provider>;
}

export function useUIState() {
  const ctx = useContext(UIStateContext);
  if (!ctx) {
    throw new Error('useUIState must be used within UIStateProvider');
  }
  return ctx;
}
