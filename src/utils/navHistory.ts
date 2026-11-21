import { useEffect, useRef } from 'react';


export interface NavState {
  view?: string;
  ex?: string;
  archive?: boolean;
  param?: string;
}

export function navState(): NavState {
  const s: unknown = window.history.state;
  return s && typeof s === 'object' ? (s as NavState) : {};
}

/** Nowy wpis w historii */
export function navPush(patch: NavState, keep: (keyof NavState)[] = []): void {
  const cur = navState();
  const next: NavState = {};
  for (const k of keep) if (cur[k] !== undefined) (next as Record<string, unknown>)[k] = cur[k];
  window.history.pushState({ ...next, ...patch }, '');
}

/** Zastępuje bieżący wpis (bez dodawania nowego). */
export function navReplace(patch: NavState, keep: (keyof NavState)[] = []): void {
  const cur = navState();
  const next: NavState = {};
  for (const k of keep) if (cur[k] !== undefined) (next as Record<string, unknown>)[k] = cur[k];
  window.history.replaceState({ ...next, ...patch }, '');
}

export function useNavListener(fn: (s: NavState) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onPop = () => ref.current(navState());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}
