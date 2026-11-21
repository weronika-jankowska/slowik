
import type { ReactNode } from 'react';
import './exercises.css';

export const BTN =
  'bg-white/45 hover:bg-white/60 text-[#466cd2] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-5 sm:px-6 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
export const BTN_PRIMARY =
  'bg-white/75 hover:bg-white/90 text-[#18388f] font-seasons font-normal text-xs sm:text-sm tracking-[0.08em] uppercase px-6 sm:px-8 py-2.5 rounded-xl shadow-md backdrop-blur-sm transition-all border border-white/50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
export const BTN_SMALL =
  'text-[11px] uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1 rounded-full cursor-pointer';

export const TONE_COLOR = {
  good: '#2f8f5b',
  ok: '#b9770e',
  work: '#c0396b',
  insufficient: '#466cd2'
} as const;

const STORAGE_KEY = 'vocal_analysis_history';

export function readMpfrRange(): { lowMidi: number; highMidi: number } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const records = JSON.parse(saved) as { mpfr?: { f0MinMidi?: number; f0MaxMidi?: number } | null }[];
    for (let i = records.length - 1; i >= 0; i--) {
      const m = records[i]?.mpfr;
      if (m && Number.isFinite(m.f0MinMidi) && Number.isFinite(m.f0MaxMidi)) {
        return { lowMidi: m.f0MinMidi as number, highMidi: m.f0MaxMidi as number };
      }
    }
  } catch {
    /* brak historii */
  }
  return null;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function MicProblem({ state }: { state: string }) {
  if (state !== 'denied' && state !== 'error') return null;
  return (
    <div className="w-full max-w-2xl bg-rose-500/25 border border-rose-200/40 rounded-xl px-4 py-3 text-sm text-center">
      {state === 'denied'
        ? 'Brak dostępu do mikrofonu. Zezwól na dostęp w ustawieniach przeglądarki i spróbuj ponownie.'
        : 'Nie udało się uruchomić mikrofonu. Sprawdź, czy jest podłączony i nieużywany przez inną aplikację.'}
    </div>
  );
}

export interface ResultTile { id: string; label: string; value: string; comment: string }

export function withItalics(text: string): ReactNode {
  const parts = text.split(/<i>(.*?)<\/i>/);
  return parts.length === 1 ? text : parts.map((p, k) => (k % 2 ? <i key={k} className="normal-case">{p}</i> : p));
}

export function ResultHeader({ tone, headline, detail }: { tone: keyof typeof TONE_COLOR; headline: string; detail: string }) {
  return (
    <div className="w-full max-w-3xl bg-white/45 backdrop-blur-md rounded-2xl border border-white/35 shadow-md px-6 py-5 text-center">
      <h2 className="font-seasons text-2xl tracking-wide" style={{ color: TONE_COLOR[tone] }}>{withItalics(headline)}</h2>
      {detail && <p className="font-cardo text-[15px] text-[#2c49a8] mt-1 leading-snug">{withItalics(detail)}</p>}
    </div>
  );
}

export function ResultTiles({ rows, colors }: { rows: ResultTile[]; colors: Record<string, string> }) {
  if (rows.length === 0) return null;
  return (
    <div className="w-full result-tiles">
      {rows.map((item) => (
        <div key={item.id} className="bg-white/40 backdrop-blur-md rounded-xl py-3 px-3 flex flex-col items-center justify-between text-center shadow-md border border-white/35 min-h-[114px] sm:min-h-[120px]">
          <h3 className="font-seasons font-normal text-[14px] sm:text-[15px] text-[#18388f] leading-tight">{item.label}</h3>
          <span className="font-seasons font-normal text-[17px] sm:text-[19px] tracking-wide my-0.5 leading-none" style={{ color: colors[item.id] ?? '#18388f' }}>{item.value}</span>
          <p className="font-cardo font-normal text-[11px] sm:text-[11.5px] text-[#466cd2] leading-[1.25] px-1">{item.comment}</p>
        </div>
      ))}
    </div>
  );
}

/** Wybór jednej z kilku opcji (pigułki) */
export function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T;
  options: { id: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-xl bg-white/35 p-1 border border-white/40">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-lg text-[13px] font-cardo transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            value === o.id ? 'bg-white/90 text-[#18388f] shadow-sm' : 'text-[#466cd2] hover:bg-white/40'
          }`}
        >
          {withItalics(o.label)}
        </button>
      ))}
    </div>
  );
}

// ---------- Układ strony ćwiczenia ----------

/** Cała strona ćwiczenia */
export function ExercisePage({ kicker, title, subtitle, onBack, children }: {
  kicker: string;
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden font-cardo text-white select-none">
      <div className="max-w-5xl mx-auto min-h-full px-4 sm:px-8 pt-24 sm:pt-8 pb-8 flex flex-col items-center gap-5 relative">
        <div className="w-full flex justify-end">
          <button
            type="button"
            onClick={onBack}
            className="text-xs uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 rounded-full transition-all cursor-pointer shadow-sm"
          >
            ← Wróć do ćwiczeń
          </button>
        </div>
        <div className="text-center">
          <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">{kicker}</span>
          <h1 className="font-seasons font-normal text-3xl sm:text-4xl md:text-[40px] tracking-[0.05em] uppercase drop-shadow-sm leading-tight">{title}</h1>
          {subtitle && <span className="text-sm text-white/70 block mt-1">{subtitle}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function SetupCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full flex-1 flex items-center justify-center">
      <div className="w-full max-w-3xl sm:pointer-events-auto bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-5 sm:p-6 text-[#18388f] flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

/** Jasna karta na treść (wyniki, film, porównania). */
export function LightCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`w-full bg-white/40 backdrop-blur-md rounded-2xl border border-white/35 shadow-md p-4 sm:p-5 text-[#18388f] ${className}`}>
      {children}
    </div>
  );
}

/** Lista kroków instrukcji; `note` – dopisek mniejszą czcionką. */
export function Instructions({ steps, note, numbered = true }: { steps: ReactNode[]; note?: ReactNode; numbered?: boolean }) {
  // bez numeracji
  if (!numbered) {
    return (
      <div className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug flex flex-col gap-1.5">
        {steps.map((s, i) => <p key={i}>{typeof s === 'string' ? withItalics(s) : s}</p>)}
        {note && <p className="text-[13px] text-[#466cd2] opacity-90">{typeof note === 'string' ? withItalics(note) : note}</p>}
      </div>
    );
  }
  return (
    <ol className="font-cardo text-[14px] sm:text-[15px] text-[#2c49a8] leading-snug list-decimal pl-5 flex flex-col gap-1.5">
      {steps.map((s, i) => <li key={i}>{typeof s === 'string' ? withItalics(s) : s}</li>)}
      {note && <li className="list-none -ml-5 pl-5 text-[13px] text-[#466cd2] opacity-90">{typeof note === 'string' ? withItalics(note) : note}</li>}
    </ol>
  );
}

/** Wybór dźwięku: − nazwa +. */
export function NotePicker({ midi, onChange, min, max, label, sub, noteName }: {
  midi: number;
  onChange: (m: number) => void;
  min: number;
  max: number;
  label: string;
  sub?: string;
  noteName: (m: number) => string;
}) {
  const circle = 'w-9 h-9 rounded-full bg-white/60 hover:bg-white/80 text-[#466cd2] text-lg leading-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center gap-3">
      <button type="button" aria-label="Dźwięk niżej" onClick={() => onChange(Math.max(min, midi - 1))} disabled={midi <= min} className={circle}>−</button>
      <div className="flex flex-col items-center min-w-[120px]">
        <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
        <span className="font-seasons text-2xl">{noteName(midi)}</span>
        {sub && <span className="text-xs opacity-70">{sub}</span>}
      </div>
      <button type="button" aria-label="Dźwięk wyżej" onClick={() => onChange(Math.min(max, midi + 1))} disabled={midi >= max} className={circle}>+</button>
    </div>
  );
}

/** Ciemna karta wykresu z odliczaniem 3-2-1 nałożonym na wykres */
export function PlotCard({ plot, countdown, legend, children, height = 'h-[280px] sm:h-[340px]' }: {
  plot: ReactNode;
  countdown?: number | null;
  legend?: ReactNode;
  children?: ReactNode;
  height?: string;
}) {
  return (
    <div className="w-full bg-[#18388f]/55 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-3 sm:p-4 flex flex-col gap-3">
      <div className={`relative w-full ${height}`}>
        {plot}
        {countdown !== null && countdown !== undefined && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span key={countdown} className="ex-countdown font-cardo text-white/90 text-[56px] sm:text-[72px] leading-none drop-shadow-md">{countdown}</span>
          </div>
        )}
      </div>
      {legend && <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-[11px] text-white/60">{legend}</div>}
      {children}
    </div>
  );
}

export function LegendItem({ swatch, children }: { swatch: string; children: ReactNode }) {
  return <span className="flex items-center gap-2"><span className={`inline-block ${swatch}`} />{children}</span>;
}

/** Wiersz stanu pod wykresem */
export function StatusRow({ left, center, centerSub, centerClass = 'text-white/80', centerSubClass = 'text-xs font-bold font-mono text-white/70', right, rightClass = 'text-emerald-400', progress, progressText, button }: {
  left: { label: string; value: ReactNode };
  center: ReactNode;
  centerSub?: ReactNode;
  centerClass?: string;
  /** Wygląd podpisu pod środkowym tekstem (domyślnie jak dotąd). */
  centerSubClass?: string;
  right: { label: string; value: ReactNode };
  rightClass?: string;
  progress?: number;
  progressText?: string;
  button?: { label: string; onClick: () => void };
}) {
  return (
    <div className="w-full flex flex-col gap-2">
      <div className="w-full flex items-center justify-between text-xs sm:text-sm">
        <div className="flex flex-col items-start">
          <span className="text-white/50 text-[10px] uppercase tracking-wider">{left.label}</span>
          <span className="font-seasons text-base">{left.value}</span>
        </div>
        <div className="flex flex-col items-center text-center">
          <span className={`text-[11px] font-semibold tracking-wider uppercase ${centerClass}`}>{center}</span>
          {centerSub !== undefined && <span className={centerSubClass}>{centerSub}</span>}
        </div>
        <div className="flex flex-col items-end">
          <span className="text-white/50 text-[10px] uppercase tracking-wider">{right.label}</span>
          <span className={`font-seasons text-base ${rightClass}`}>{right.value}</span>
        </div>
      </div>
      {(progress !== undefined || button) && (
        <div className="w-full flex items-center gap-3">
          <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)}%` }} />
          </div>
          {progressText && <span className="text-[11px] opacity-75 w-24 text-right">{progressText}</span>}
          {button && <button type="button" onClick={button.onClick} className={BTN_SMALL}>{button.label}</button>}
        </div>
      )}
    </div>
  );
}

/** Rząd przycisków pod wynikami. */
export function ResultActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-row flex-wrap justify-center items-center gap-3 sm:gap-4 mt-1 pb-6">{children}</div>;
}

const LS_PREFIX = 'exercise_best_';

/** Rekord użytkownika (np. najdłuższy dźwięk) */
export function readBest(key: string): number {
  try {
    const v = Number(localStorage.getItem(LS_PREFIX + key));
    return Number.isFinite(v) && v > 0 ? v : NaN;
  } catch {
    return NaN;
  }
}

export function saveBest(key: string, value: number): void {
  try {
    const prev = readBest(key);
    if (!(value <= prev)) localStorage.setItem(LS_PREFIX + key, String(value));
  } catch {
    /* brak dostępu do localStorage */
  }
}

/** Ustawia rekord na podaną wartość (także niższą) */
export function setBest(key: string, value: number): void {
  try {
    localStorage.setItem(LS_PREFIX + key, String(value));
  } catch {
    /* brak dostępu do localStorage */
  }
}

export const fmt1 = (x: number) =>
  Number.isFinite(x) ? x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—';
