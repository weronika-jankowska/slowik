import { useEffect, useRef, useState } from 'react';
import {
  BTN,
  BTN_PRIMARY,
  ExercisePage,
  LightCard,
  MicProblem,
  PlotCard,
  ResultActions,
  ResultHeader,
  StatusRow,
  fmt1,
  readBest,
  saveBest
} from './exerciseUi';
import { useTake, type TakeFrame } from '../../hooks/useTake';

// Przygotowanie do ćwiczeń

type Step =
  | { kind: 'timer'; title: string; text: string; seconds: number }
  | { kind: 'phases'; title: string; text: string; phases: Phase[] }
  | { kind: 'hiss'; title: string; text: string };

/** Faza kroku */
interface Phase { label: string; seconds: number; hint: string; signal?: boolean }

/** Rozmiar koła oddechu: małe (pusto) i pełne. */
const CIRCLE_MIN = 0.45;
const CIRCLE_MID = 0.7;
/** Fazy ruchu ze swobodnym oddechem – koło lekko pulsuje. */
const PULSING = new Set(['W przód', 'W tył']);
/** Pulsowanie koła */
const PULSE_PERIOD_SEC = 4;
const PULSE_AMPLITUDE = 0.06;

function pulse(p: Phase, elapsed: number): number {
  const cycles = Math.max(1, Math.round(p.seconds / PULSE_PERIOD_SEC));
  return PULSE_AMPLITUDE * Math.sin((2 * Math.PI * cycles * elapsed) / p.seconds);
}

/** Rozmiar koła w danej chwili fazy: wdech */
function circleScale(p: Phase, elapsed: number, prevScale: number): number {
  const k = Math.min(1, Math.max(0, elapsed / p.seconds));
  const ease = 0.5 - 0.5 * Math.cos(Math.PI * k);
  if (p.label === 'Wdech') return CIRCLE_MIN + (1 - CIRCLE_MIN) * ease;
  if (p.label === 'Wydech') return 1 - (1 - CIRCLE_MIN) * ease;
  if ((p.label === 'Stop' || p.label === 'Powrót') && prevScale <= CIRCLE_MIN + 0.01) return CIRCLE_MIN + pulse(p, elapsed);
  const target = p.label === 'Stop' ? 1 : CIRCLE_MID;
  const j = Math.min(1, elapsed / 0.4);
  const base = prevScale + (target - prevScale) * (0.5 - 0.5 * Math.cos(Math.PI * j));
  if (!PULSING.has(p.label)) return base;
  // swobodny oddech w trakcie ruchu
  return base + pulse(p, elapsed);
}

function scaleBefore(phases: Phase[], i: number): number {
  let s = CIRCLE_MIN;
  for (let k = 0; k < i; k++) { const p = phases[k] as Phase; s = circleScale(p, p.seconds, s); }
  return s;
}


const STEPS: Step[] = [
  {
    kind: 'phases',
    title: 'Barki',
    text: 'Unieś barki wysoko w stronę uszu na wdechu, przytrzymaj je chwilę i opuść razem z wydechem. Następnie kilka razy powoli zatocz nimi koło do tyłu i w przód.',
    phases: [
      { label: 'Wdech', seconds: 3, hint: 'Unieś barki do góry, biorąc wdech' },
      { label: 'Stop', seconds: 5, hint: 'Przytrzymaj barki w górze' },
      { label: 'Wydech', seconds: 3, hint: 'Opuść barki, wydychając powietrze' },
      { label: 'W przód', seconds: 15, hint: 'Wykonaj krążenia barków w przód' },
      { label: 'W tył', seconds: 15, hint: 'Wykonaj krążenia barków w tył' }
    ]
  },
  {
    kind: 'timer',
    title: 'Szyja',
    text: 'Opuść brodę w stronę mostka i powoli przetaczaj głowę półkolem od jednego barku do drugiego.',
    seconds: 30
  },
  {
    kind: 'timer',
    title: 'Twarz i żuchwa',
    text: 'Rozmasuj palcami mięśnie przed uszami, tam gdzie zaczyna się żuchwa. Potem pozwól jej luźno opaść i kilka razy delikatnie porusz nią na boki.',
    seconds: 30
  },
  {
    kind: 'phases',
    title: 'Rozciąganie klatki piersiowej',
    text: 'Unieś ręce do góry i weź głęboki wdech. Na wydechu pochyl się w lewo i zatrzymaj się w tej pozycji. Powróć do środka na wdechu i przechyl się w prawo na wydechu. Możesz wykonywać ćwiczenie na stojąco lub siedząc „po turecku”.',
    phases: [
      { label: 'Wdech', seconds: 3, hint: 'Weź wdech i unieś ręce do góry' },
      { label: 'Wydech', seconds: 3, hint: 'Przechyl się w lewo na wydechu' },
      { label: 'Stop', seconds: 10, hint: 'Zatrzymaj się w tej pozycji. Oddychaj swobodnie' },
      { label: 'Wdech', seconds: 3, hint: 'Weź wdech i powróć do środka' },
      { label: 'Wydech', seconds: 3, hint: 'Przechyl się w prawo na wydechu' },
      { label: 'Stop', seconds: 10, hint: 'Zatrzymaj się w tej pozycji. Oddychaj swobodnie' },
      { label: 'Wdech', seconds: 3, hint: 'Weź wdech i powróć do środka' }
    ]
  },
  {
    kind: 'phases',
    title: 'Rozciąganie kręgosłupa',
    text: 'Rozstaw stopy na szerokości bioder. Unieś ręce do góry na wdechu. Na wydechu zegnij całe ciało i opuść swobodnie ręce w kierunku podłogi. Pozostań w tej pozycji i rozluźnij się. Po usłyszeniu dźwięku powróć do pozycji stojącej, kręg po kręgu.',
    phases: [
      { label: 'Wdech', seconds: 3, hint: 'Weź wdech, unosząc ręce do góry' },
      { label: 'Wydech', seconds: 3, hint: 'Wydychaj powietrze, pochyl się do przodu i opuść ręce' },
      { label: 'Stop', seconds: 30, hint: 'Zatrzymaj się i rozluźnij', signal: true },
      { label: 'Powrót', seconds: 5, hint: 'Powoli podnieś się z powrotem, kręg po kręgu' }
    ]
  },
  {
    kind: 'hiss',
    title: 'Długi syk',
    text: 'Weź spokojny, głęboki wdech i wypuszczaj powietrze na równym „sss” tak długo, jak dasz radę – bez wypychania resztek powietrza na siłę. Aplikacja zmierzy czas syku.'
  }
];

const BEST_KEY = 'hiss_sec';
const MAX_HISS_SEC = 90;

function stepSeconds(s: Step): number {
  if (s.kind === 'timer') return s.seconds;
  if (s.kind === 'phases') return s.phases.reduce((a, p) => a + p.seconds, 0);
  return 0;
}

/** Bieżąca faza kroku z fazami: indeks, czas od początku fazy. */
/** Sygnał końca zatrzymania: krótkie, łagodne piknięcie */
const SIGNAL_URL = '/sounds/sygnal.wav';
const END_HINT = 'Rozluźnij się i oddychaj swobodnie';

function phaseAt(phases: Phase[], t: number): { index: number; elapsed: number } {
  let c = t;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i] as Phase;
    if (c < p.seconds || i === phases.length - 1) return { index: i, elapsed: Math.min(c, p.seconds) };
    c -= p.seconds;
  }
  return { index: 0, elapsed: 0 };
}

/** Czas syku */
function hissDuration(frames: TakeFrame[], threshold: number): number {
  let best = 0, runStart = NaN, last = NaN;
  for (const f of frames) {
    if (f.rms < threshold) continue;
    if (!Number.isFinite(last) || f.t - last > 0.4) runStart = f.t;
    last = f.t;
    best = Math.max(best, last - runStart);
  }
  return best;
}

export default function PrepareExercise({ onBack }: { onBack: () => void }) {
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [t, setT] = useState(0);
  const [done, setDone] = useState<boolean[]>(() => STEPS.map(() => false));
  const [hiss, setHiss] = useState<{ sec: number; prevBest: number } | null>(null);
  const take = useTake();
  const lastTickRef = useRef<number | null>(null);
  const step = STEPS[index] as Step;
  const total = stepSeconds(step);
  const finished = total > 0 && t >= total;

  // minutnik kroku
  useEffect(() => {
    if (!running) { lastTickRef.current = null; return; }
    const id = window.setInterval(() => {
      const now = performance.now() / 1000;
      const prev = lastTickRef.current ?? now;
      lastTickRef.current = now;
      setT((x) => Math.min(total, x + (now - prev)));
    }, 100);
    return () => window.clearInterval(id);
  }, [running, total]);

  // koniec każdego „Stop”
  const prevTRef = useRef(0);
  useEffect(() => {
    const prevT = prevTRef.current;
    prevTRef.current = t;
    if (!running || step.kind !== 'phases' || t <= prevT) return;
    let end = 0;
    for (const p of step.phases) {
      end += p.seconds;
      if (p.signal && prevT < end && t >= end) { const a = new Audio(SIGNAL_URL); a.volume = 0.8; void a.play().catch(() => undefined); break; }
    }
  }, [t, running, step]);

  useEffect(() => {
    if (finished && running) {
      setRunning(false);
      setDone((d) => d.map((v, i) => (i === index ? true : v)));
    }
  }, [finished, running, index]);

  const goTo = (i: number) => {
    take.cancel();
    setRunning(false);
    setT(0);
    setHiss(null);
    setIndex(Math.max(0, Math.min(STEPS.length - 1, i)));
  };

  const startHiss = () => {
    setHiss(null);
    void take.run({
      maxSec: MAX_HISS_SEC,
      startOn: 'sound',
      endOnSilenceSec: 0.6,
      minSoundSec: 1,
      onDone: (frames) => {
        const loud = frames.map((f) => f.rms).sort((a, b) => a - b);
        const med = loud[Math.floor(loud.length * 0.6)] ?? 0;
        const sec = hissDuration(frames, Math.max(0.004, med * 0.35));
        const prevBest = readBest(BEST_KEY);
        saveBest(BEST_KEY, Math.round(sec * 10) / 10);
        setHiss({ sec, prevBest });
        setDone((d) => d.map((v, i) => (i === index ? true : v)));
      }
    });
  };

  const remaining = Math.max(0, Math.ceil(total - t));
  // krok z fazami
  const ph = step.kind === 'phases' ? phaseAt(step.phases, t) : null;
  const phase = step.kind === 'phases' && ph ? (step.phases[ph.index] as Phase) : null;
  const ringFrac = t / Math.max(1, total);
  // po zakończeniu koło wraca do pełnego rozmiaru
  const scale = step.kind === 'phases' && phase && ph
    ? (finished ? 1 : running || t > 0 ? circleScale(phase, ph.elapsed, scaleBefore(step.phases, ph.index)) : CIRCLE_MIN)
    : CIRCLE_MIN;

  return (
    <ExercisePage kicker="Ćwiczenie ogólne" title="Przygotowanie do ćwiczeń" subtitle="rozluźnienie i oddech" onBack={() => { take.cancel(); onBack(); }}>
      {/* postęp kroków */}
      <div className="w-full flex flex-wrap justify-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            onClick={() => goTo(i)}
            className={`px-3 py-1 rounded-full text-[12px] border transition-all cursor-pointer ${
              i === index ? 'bg-white/85 text-[#18388f] border-white' : done[i] ? 'bg-emerald-400/25 text-white border-emerald-300/60' : 'bg-white/10 text-white/80 border-white/25 hover:bg-white/20'
            }`}
          >
            {done[i] && i !== index ? '✓ ' : `${i + 1}. `}{s.title}
          </button>
        ))}
      </div>

      {step.kind !== 'hiss' && (
        <LightCard className="max-w-3xl flex flex-col items-center gap-5 text-center">
          <h2 className="font-seasons text-2xl tracking-wide">{step.title}</h2>
          <p className="font-cardo text-[15px] text-[#2c49a8] leading-snug max-w-2xl">{step.text}</p>
          {phase && ph ? (
            // kroki z oddechem
            <div className="relative w-48 h-48 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-white/20 border border-white/40" />
              <div
                className="absolute rounded-full bg-gradient-to-br from-[#ffc2ea] via-[#ff8fcf] to-[#ffb27a] shadow-lg"
                style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, transition: finished ? 'width 1.2s ease-out, height 1.2s ease-out' : 'width .12s linear, height .12s linear' }}
              />
              <div className="relative flex flex-col items-center text-[#18388f]">
                {finished ? (
                  <span className="font-seasons text-xl leading-tight">Koniec</span>
                ) : (
                  <>
                    <span className="font-seasons text-xl leading-tight">{phase.label}</span>
                    <span className="font-cardo text-sm">{Math.max(0, Math.ceil(phase.seconds - ph.elapsed))} s</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="relative w-40 h-40">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="6" />
                <defs>
                  {/* ten sam różowy gradient co koło oddechu i ikony ćwiczeń */}
                  <linearGradient id="prep-ring" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffc2ea" />
                    <stop offset=".5" stopColor="#ff8fcf" />
                    <stop offset="1" stopColor="#ffb27a" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="44" fill="none" stroke="url(#prep-ring)" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 44} strokeDashoffset={2 * Math.PI * 44 * (1 - Math.min(1, ringFrac))} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-seasons text-3xl">{finished ? 'Koniec' : `${remaining} s`}</span>
            </div>
          )}
          {phase && <p className="font-cardo text-[16px] text-[#18388f] leading-snug -mt-2 min-h-[1.5em]">{finished ? END_HINT : phase.hint}</p>}

          <div className="flex flex-wrap justify-center gap-3">
            {index > 0 && <button type="button" onClick={() => goTo(index - 1)} className={BTN}>Wstecz</button>}
            {!finished && (
              <button type="button" onClick={() => setRunning((r) => !r)} className={BTN_PRIMARY}>
                {running ? 'Pauza' : t > 0 ? 'Wznów' : 'Rozpocznij'}
              </button>
            )}
            <button type="button" onClick={() => goTo(index + 1)} className={finished ? BTN_PRIMARY : BTN}>
              {finished ? 'Dalej' : 'Pomiń'}
            </button>
          </div>
        </LightCard>
      )}

      {step.kind === 'hiss' && (
        <>
          {/* po pomiarze wystarczy wynik – opis ćwiczenia znika */}
          {!(take.phase === 'done' && hiss) && (
            <LightCard className="max-w-3xl text-center">
              <h2 className="font-seasons text-2xl tracking-wide">{step.title}</h2>
              <p className="font-cardo text-[15px] text-[#2c49a8] leading-snug mt-1">{step.text}</p>
            </LightCard>
          )}

          {(take.phase === 'countdown' || take.phase === 'recording') && (
            <PlotCard
              height="h-[200px]"
              countdown={take.phase === 'countdown' ? take.countdown : null}
              plot={
                <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                  {take.phase === 'recording' && (
                    <>
                      <span className="font-seasons text-6xl tabular-nums">{fmt1(take.started ? take.elapsed : 0)} s</span>
                      <div className="w-2/3 h-3 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${Math.min(100, (take.live?.rms ?? 0) * 900)}%` }} />
                      </div>
                    </>
                  )}
                </div>
              }
            >
              {take.phase === 'recording' && (
                <StatusRow
                  left={{ label: 'Rekord', value: Number.isFinite(readBest(BEST_KEY)) ? `${fmt1(readBest(BEST_KEY))} s` : '—' }}
                  center={!take.started ? 'Cisza… nabierz powietrza i zacznij „sss”' : take.live?.sounding ? 'Równy syk' : 'Syk słabnie…'}
                  right={{ label: '', value: '' }}
                  button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : take.cancel }}
                />
              )}
            </PlotCard>
          )}
          <MicProblem state={take.micState} />

          {take.phase === 'idle' && (
            <ResultActions>
              <button type="button" onClick={() => goTo(index - 1)} className={BTN}>Wstecz</button>
              <button type="button" onClick={startHiss} className={BTN_PRIMARY}>Rozpocznij</button>
            </ResultActions>
          )}

          {take.phase === 'done' && hiss && (
            <div className="w-full flex flex-col items-center gap-4">
              <ResultHeader
                tone={hiss.sec >= 20 ? 'good' : hiss.sec >= 10 ? 'ok' : 'work'}
                headline={`Syk trwał ${fmt1(hiss.sec)} s`}
                detail={
                  Number.isFinite(hiss.prevBest)
                    ? hiss.sec > hiss.prevBest
                      ? `Nowy rekord! Poprzednio najdłużej: ${fmt1(hiss.prevBest)} s.`
                      : `Twój rekord to ${fmt1(hiss.prevBest)} s. Liczy się równy, spokojny wydech, nie wynik na siłę.`
                    : 'To Twój pierwszy pomiar – kolejne będą porównywane z tym wynikiem.'
                }
              />
              <p className="font-cardo text-sm text-white/80 max-w-2xl text-center">
                Rozgrzewka gotowa. Możesz przejść do ćwiczeń z głosem.
              </p>
              <ResultActions>
                <button type="button" onClick={startHiss} className={BTN}>Zmierz jeszcze raz</button>
                <button type="button" onClick={onBack} className={BTN_PRIMARY}>Przejdź do ćwiczeń</button>
              </ResultActions>
            </div>
          )}
        </>
      )}
    </ExercisePage>
  );
}
