import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BTN, BTN_PRIMARY, LightCard, NotePicker, Segmented, readMpfrRange } from '../exercises/exerciseUi';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName, playReferenceNote } from '../../utils/noteUtils';
import { pitchYIN } from '../../utils/audioMetrics';
import { BREATH_LEVEL_TEXT } from '../../utils/breathiness';
import {
  VARIANTS,
  analyzeTake,
  audioUrl,
  buildPlan,
  checkPassword,
  encodeWav,
  listTakes,
  samplesAvailable,
  saveRecord,
  saveTake,
  variantLabel,
  type LabPlanSettings,
  type PlanItem,
  type TakeRecord
} from '../../utils/breathLab';

// Ukryte okno do zbierania próbek głosu (kalibracja oceny powietrza). Otwierane skrótem
// Control + G (Mac i Windows) i chronione hasłem. Nagrania i wyniki trafiają do folderu
// audio-breathiness w katalogu projektu – działa tylko z serwerem deweloperskim (npm run dev).

/** Długość nagrania [s] – liczona od kliknięcia „Nagraj”. */
const TAKE_SEC = 3;
const SETTINGS_KEY = 'slowik_lab_settings';
const UNLOCK_KEY = 'slowik_lab_unlocked';

// ---------- Nagrywanie surowego dźwięku (bez przetwarzania przeglądarki) ----------

const WORKLET = `class SlowikRec extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('slowik-rec', SlowikRec);`;

interface Mic {
  ctx: AudioContext;
  analyser: AnalyserNode;
  stream: MediaStream;
  onChunk: { current: ((c: Float32Array) => void) | null };
}

async function openMic(): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  src.connect(analyser);
  const onChunk: Mic['onChunk'] = { current: null };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);
  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'slowik-rec');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk.current?.(e.data);
    src.connect(node).connect(mute);
  } else {
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    sp.onaudioprocess = (e) => onChunk.current?.(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(sp).connect(mute);
  }
  return { ctx, analyser, stream, onChunk };
}

function closeMic(m: Mic | null) {
  if (!m) return;
  m.onChunk.current = null;
  m.stream.getTracks().forEach((t) => t.stop());
  void m.ctx.close();
}

// ---------- Formatowanie ----------

const fmt = (v: number | null | undefined, d = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';

const LEVEL_COLOR: Record<string, string> = { none: 'text-emerald-700', moderate: 'text-amber-700', clear: 'text-rose-700' };

type Phase = 'idle' | 'recording' | 'analyzing' | 'done' | 'error';

// ---------- Hasło ----------

function PasswordGate({ onUnlock, onBack }: { onUnlock: () => void; onBack: () => void }) {
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = async () => {
    if (await checkPassword(pw)) onUnlock();
    else { setWrong(true); setPw(''); }
  };
  return (
    <LightCard className="max-w-sm w-full">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 className="font-seasons text-xl text-center">Dostęp chroniony</h2>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => { setPw(e.target.value); setWrong(false); }}
          placeholder="Hasło"
          className="w-full rounded-lg border border-[#466cd2]/30 bg-white/80 px-3 py-2 text-[#18388f] outline-none focus:border-[#466cd2]"
        />
        {wrong && <p className="text-[13px] text-rose-700 -mt-1">Nieprawidłowe hasło.</p>}
        <div className="flex justify-center gap-3">
          <button type="button" onClick={onBack} className={BTN}>Wróć</button>
          <button type="submit" className={BTN_PRIMARY}>Wejdź</button>
        </div>
      </form>
    </LightCard>
  );
}

// ---------- Główne okno ----------

function defaultSettings(): LabPlanSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as LabPlanSettings | null;
    if (s && typeof s.lowMidi === 'number') return s;
  } catch { /* brak zapisanych ustawień */ }
  const r = readMpfrRange();
  const low = r ? r.lowMidi + 2 : 55;
  const high = r ? r.highMidi - 2 : 74;
  return { lowMidi: low, highMidi: Math.max(low + 4, high), step: 2, reps: 2, withFalsetto: true, falsettoFromMidi: Math.round((low + high) / 2) };
}

export default function BreathinessLab({ onBack }: { onBack: () => void }) {
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch { return false; }
  });
  const [available, setAvailable] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<LabPlanSettings>(defaultSettings);
  const plan = useMemo(() => buildPlan(settings), [settings]);
  const [records, setRecords] = useState<TakeRecord[]>([]);
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [liveCents, setLiveCents] = useState<number | null>(null);
  const [error, setError] = useState('');
  /** Wskaźnik i ocena kryterium są domyślnie ukryte, żeby nie sugerowały oceny na słuch. */
  const [showIndex, setShowIndex] = useState(false);
  const micRef = useRef<Mic | null>(null);
  const abortRef = useRef(false);
  const refPlayRef = useRef<ReturnType<typeof playReferenceNote> | null>(null);
  /** Ostatnio nagrane (żeby po automatycznym przejściu dalej można je było odsłuchać i powtórzyć). */
  const [lastName, setLastName] = useState<string | null>(null);

  const byName = useMemo(() => new Map(records.map((r) => [r.name, r])), [records]);
  const item: PlanItem | undefined = plan[Math.min(current, plan.length - 1)];
  const rec = item ? byName.get(item.name) : undefined;
  const doneCount = plan.filter((p) => byName.has(p.name)).length;

  const refresh = useCallback(async () => {
    try { setRecords(await listTakes()); } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    void (async () => {
      const ok = await samplesAvailable();
      setAvailable(ok);
      if (ok) {
        const list = await listTakes().catch(() => [] as TakeRecord[]);
        setRecords(list);
        // zacznij od pierwszego nienagranego
        const names = new Set(list.map((r) => r.name));
        const first = buildPlan(settings).findIndex((p) => !names.has(p.name));
        setCurrent(first < 0 ? 0 : first);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* bez zapisu */ }
  }, [settings]);

  useEffect(() => () => { abortRef.current = true; closeMic(micRef.current); micRef.current = null; }, []);

  const unlock = () => {
    try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch { /* bez zapamiętania */ }
    setUnlocked(true);
  };

  const stopReference = () => { refPlayRef.current?.cancel(); refPlayRef.current = null; };
  const playReference = (midi: number) => { stopReference(); refPlayRef.current = playReferenceNote(midi); };

  /** Nagranie od razu po kliknięciu (bez odliczania), TAKE_SEC sekund; potem zapis i przejście dalej. */
  const record = async (target: PlanItem, advance: boolean) => {
    setError('');
    abortRef.current = false;
    stopReference();
    try {
      if (!micRef.current) micRef.current = await openMic();
      const mic = micRef.current;
      if (mic.ctx.state === 'suspended') await mic.ctx.resume();

      // nagranie: surowe próbki z węzła nagrywającego, podgląd wysokości z analizatora
      const chunks: Float32Array[] = [];
      const sr = mic.ctx.sampleRate;
      const need = Math.round(TAKE_SEC * sr);
      let got = 0;
      setPhase('recording'); setElapsed(0);
      const targetHz = getCalibratedMidiFreq(target.midi);
      const buf = new Float32Array(mic.analyser.fftSize);
      await new Promise<void>((resolve) => {
        mic.onChunk.current = (c) => {
          if (got >= need) return;
          chunks.push(c); got += c.length;
          if (got >= need) { mic.onChunk.current = null; resolve(); }
        };
        const tick = () => {
          if (got >= need || abortRef.current) { if (abortRef.current) resolve(); return; }
          setElapsed(got / sr);
          mic.analyser.getFloatTimeDomainData(buf);
          const f0 = pitchYIN(buf, sr, 0.15);
          setLiveCents(f0 >= 50 && f0 <= 1100 ? 1200 * Math.log2(f0 / targetHz) : null);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      if (abortRef.current) { setPhase('idle'); return; }
      const x = new Float32Array(need);
      let o = 0;
      for (const c of chunks) { x.set(c.subarray(0, Math.min(c.length, need - o)), o); o += c.length; if (o >= need) break; }

      setPhase('analyzing');
      await new Promise((r) => window.setTimeout(r, 30)); // odśwież widok przed obliczeniami
      const measures = analyzeTake(x, sr, target.midi);
      const rec: TakeRecord = {
        name: target.name,
        midi: target.midi,
        note: midiToNoteName(target.midi),
        targetHz: Math.round(targetHz * 100) / 100,
        variant: target.variant,
        rep: target.rep,
        sampleRate: sr,
        durationSec: TAKE_SEC,
        recordedAt: new Date().toISOString(),
        measures,
        rating: null
      };
      await saveTake(rec, encodeWav(x, sr));
      await refresh();
      setLastName(target.name);
      setPhase('done');
      if (advance) setCurrent((c) => Math.min(plan.length - 1, c + 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };
  const recordCurrent = () => { if (item) void record(item, current < plan.length - 1); };

  const busy = phase === 'recording' || phase === 'analyzing';
  const cancel = () => { stopReference(); abortRef.current = true; if (micRef.current) micRef.current.onChunk.current = null; setPhase('idle'); };
  const goTo = (i: number) => { if (busy) return; setCurrent(Math.max(0, Math.min(plan.length - 1, i))); setPhase('idle'); };

  // nowa wysokość → automatycznie zagraj dźwięk wzorcowy (kliknięcie „Nagraj” go przerywa)
  const prevMidiRef = useRef<number | null>(null);
  useEffect(() => {
    if (!unlocked || !available || !item) return;
    if (prevMidiRef.current !== item.midi) { prevMidiRef.current = item.midi; playReference(item.midi); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.midi, unlocked, available]);
  useEffect(() => () => stopReference(), []);

  // spacja – nagraj, strzałki – poprzednie / następne
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    if (!unlocked || !available) return;
    if (e.code === 'Space') { e.preventDefault(); if (!busy) recordCurrent(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const last = lastName ? byName.get(lastName) : undefined;

  const setRating = async (r: TakeRecord, rating: number | null) => {
    const next = { ...r, rating };
    setRecords((rs) => rs.map((x) => (x.name === r.name ? next : x)));
    try { await saveRecord(next); } catch (e) { setError(String(e)); }
  };

  const sorted = useMemo(() => {
    const order = new Map(VARIANTS.map((v, i) => [v.id, i]));
    return [...records].sort((a, b) => a.midi - b.midi || (order.get(a.variant) ?? 0) - (order.get(b.variant) ?? 0) || a.rep - b.rep);
  }, [records]);

  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden font-cardo text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 pt-24 sm:pt-10 pb-14 flex flex-col items-center gap-5">
        <div className="w-full flex justify-end">
          <button type="button" onClick={() => { cancel(); onBack(); }} className="text-xs uppercase tracking-wider text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-1.5 rounded-full transition-all cursor-pointer shadow-sm">
            ← Menu
          </button>
        </div>
        <div className="text-center">
          <span className="text-xs uppercase tracking-widest text-white/60 block mb-1">Narzędzie badawcze</span>
          <h1 className="font-seasons font-normal uppercase text-3xl sm:text-4xl tracking-[0.05em]">Próbki głosu</h1>
          <p className="text-sm text-white/85 mt-1">kalibracja oceny powietrza w głosie – samogłoska [a]</p>
        </div>

        {!unlocked && <PasswordGate onUnlock={unlock} onBack={onBack} />}

        {unlocked && available === false && (
          <LightCard className="max-w-2xl text-center">
            <p className="text-[15px]">Zapisywanie próbek działa tylko wtedy, gdy aplikacja jest uruchomiona lokalnie poleceniem <code>npm run dev</code> – nagrania trafiają wtedy do folderu <code>audio-breathiness</code> w katalogu projektu.</p>
          </LightCard>
        )}

        {unlocked && available && (
          <>
            {/* ---------- Ustawienia ---------- */}
            <LightCard className="w-full">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-end justify-center gap-6">
                  <NotePicker midi={settings.lowMidi} onChange={(m) => setSettings((s) => ({ ...s, lowMidi: Math.min(m, s.highMidi) }))} min={36} max={settings.highMidi} label="Najniższy dźwięk" sub={`${formatDecimalPl(getCalibratedMidiFreq(settings.lowMidi), 1)} Hz`} noteName={midiToNoteName} />
                  <NotePicker midi={settings.highMidi} onChange={(m) => setSettings((s) => ({ ...s, highMidi: Math.max(m, s.lowMidi) }))} min={settings.lowMidi} max={84} label="Najwyższy dźwięk" sub={`${formatDecimalPl(getCalibratedMidiFreq(settings.highMidi), 1)} Hz`} noteName={midiToNoteName} />
                  {settings.withFalsetto && (
                    <NotePicker midi={settings.falsettoFromMidi} onChange={(m) => setSettings((s) => ({ ...s, falsettoFromMidi: m }))} min={settings.lowMidi} max={settings.highMidi} label="Falset od" sub="dźwięku w górę" noteName={midiToNoteName} />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider opacity-70">Co</span>
                    <Segmented value={String(settings.step)} onChange={(v) => setSettings((s) => ({ ...s, step: Number(v) }))} options={[{ id: '1', label: '1 półton' }, { id: '2', label: '2 półtony' }, { id: '3', label: '3 półtony' }]} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider opacity-70">Powtórzenia</span>
                    <Segmented value={String(settings.reps)} onChange={(v) => setSettings((s) => ({ ...s, reps: Number(v) }))} options={[{ id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' }]} />
                  </div>
                  <label className="flex items-center gap-2 text-[14px] cursor-pointer">
                    <input type="checkbox" checked={settings.withFalsetto} onChange={(e) => setSettings((s) => ({ ...s, withFalsetto: e.target.checked }))} />
                    falset
                  </label>
                </div>
                <p className="text-[13px] text-[#466cd2] text-center">
                  Plan: {plan.length} nagrań po {TAKE_SEC} s, nagrane: {doneCount}. Nagrywanie startuje od razu po kliknięciu „Nagraj” (albo spacji); po zapisie okno przechodzi do następnego nagrania, a przy nowej wysokości samo gra dźwięk wzorcowy. Strzałki ← → przełączają nagrania. Mikrofon bez przetwarzania przeglądarki (jak w aplikacji). Nagrywaj zawsze z tej samej odległości od mikrofonu i ze średnią, podobną głośnością.
                </p>
              </div>
            </LightCard>

            {/* ---------- Bieżące nagranie ---------- */}
            {item && (
              <div className="w-full bg-[#18388f]/55 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-4 sm:p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-white/60">Nagranie {current + 1} z {plan.length}</span>
                    <h2 className="font-seasons text-2xl">
                      {midiToNoteName(item.midi)} <span className="text-base text-white/70">({formatDecimalPl(getCalibratedMidiFreq(item.midi), 1)} Hz)</span> · {variantLabel(item.variant)}
                      {settings.reps > 1 && <span className="text-base text-white/70"> · powtórzenie {item.rep}</span>}
                    </h2>
                    <p className="text-[14px] text-white/80">{VARIANTS.find((v) => v.id === item.variant)?.hint}</p>
                  </div>
                  <div className="text-center min-w-[140px]">
                    {phase === 'recording' && (
                      <div className="flex flex-col items-center">
                        <span className="font-seasons text-lg text-rose-300">● Nagrywanie {formatDecimalPl(elapsed, 1)} s</span>
                        <span className={`text-sm ${liveCents !== null && Math.abs(liveCents) <= 30 ? 'text-emerald-300' : 'text-white/70'}`}>
                          {liveCents === null ? '—' : `${liveCents > 0 ? '+' : ''}${Math.round(liveCents)} ct od wzorca`}
                        </span>
                      </div>
                    )}
                    {phase === 'analyzing' && <span className="font-seasons text-lg">Zapisuję i liczę…</span>}
                  </div>
                </div>
                {phase === 'recording' && (
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-rose-400" style={{ width: `${(elapsed / TAKE_SEC) * 100}%` }} /></div>
                )}

                {last && !busy && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] bg-white/10 rounded-xl px-3 py-2">
                    <span className="text-white/70">Ostatnie: <b className="font-seasons text-white">{last.note} · {variantLabel(last.variant)}{settings.reps > 1 ? ` (${last.rep})` : ''}</b></span>
                    <span>f0 <b className="font-seasons">{fmt(last.measures.f0Hz)} Hz</b> ({fmt(last.measures.centsOff, 0)} ct)</span>
                    <span>CPPS <b className="font-seasons">{fmt(last.measures.cppsDb)} dB</b></span>
                    <span>nachylenie <b className="font-seasons">{fmt(last.measures.tiltDbOct)} dB/okt</b></span>
                    <span>poziom <b className="font-seasons">{fmt(last.measures.levelDbfs)} dBFS</b></span>
                    <audio controls src={audioUrl(last)} className="h-9" />
                    <button
                      type="button"
                      onClick={() => { const p = plan.find((x) => x.name === last.name); if (p) void record(p, false); }}
                      className="text-[11px] uppercase tracking-wider text-white/90 hover:text-white bg-white/10 hover:bg-white/20 border border-white/25 px-3 py-1 rounded-full cursor-pointer"
                    >
                      Powtórz ostatnie
                    </button>
                  </div>
                )}
                {error && <p className="text-rose-200 text-[14px]">{error}</p>}

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button type="button" onClick={() => goTo(current - 1)} disabled={busy || current === 0} className={BTN}>← Poprzednie</button>
                  {busy ? (
                    <button type="button" onClick={cancel} className={BTN}>Przerwij</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => item && playReference(item.midi)} className={BTN}>♪ Dźwięk</button>
                      <button type="button" onClick={recordCurrent} className={BTN_PRIMARY}>{rec ? 'Nagraj ponownie (nadpisz)' : 'Nagraj'}</button>
                    </>
                  )}
                  <button type="button" onClick={() => goTo(current + 1)} disabled={busy || current >= plan.length - 1} className={BTN}>Dalej →</button>
                </div>

                {/* mapa planu */}
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {plan.map((p, i) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => goTo(i)}
                      title={`${midiToNoteName(p.midi)} · ${variantLabel(p.variant)} · ${p.rep}`}
                      className={`w-3.5 h-3.5 rounded-sm border cursor-pointer ${i === current ? 'border-white scale-125' : 'border-white/30'} ${byName.has(p.name) ? 'bg-emerald-400' : 'bg-white/15'}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ---------- Wyniki ---------- */}
            {sorted.length > 0 && (
              <LightCard className="w-full">
                <div className="w-full overflow-x-auto">
                  <table className="w-full text-[13px] border-collapse">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-[#466cd2]">
                        <th className="py-1.5 pr-3">Dźwięk</th>
                        <th className="py-1.5 pr-3">f0 [Hz]</th>
                        <th className="py-1.5 pr-3">Wariant</th>
                        <th className="py-1.5 pr-3">CPPS [dB]</th>
                        <th className="py-1.5 pr-3">Nachylenie [dB/okt]</th>
                        <th className="py-1.5 pr-3">Poziom [dBFS]</th>
                        {showIndex && <th className="py-1.5 pr-3">Wskaźnik</th>}
                        {showIndex && <th className="py-1.5 pr-3">Ocena (kryterium)</th>}
                        <th className="py-1.5 pr-3">Na słuch</th>
                        <th className="py-1.5">Nagranie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => (
                        <tr key={r.name} className="border-t border-[#466cd2]/15 align-middle">
                          <td className="py-1.5 pr-3 font-seasons">{r.note}</td>
                          <td className="py-1.5 pr-3">{fmt(r.measures.f0Hz)}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{variantLabel(r.variant)}{r.rep > 1 ? ` (${r.rep})` : ''}</td>
                          <td className="py-1.5 pr-3">{fmt(r.measures.cppsDb)}</td>
                          <td className="py-1.5 pr-3">{fmt(r.measures.tiltDbOct)}</td>
                          <td className="py-1.5 pr-3">{fmt(r.measures.levelDbfs)}</td>
                          {showIndex && <td className="py-1.5 pr-3">{fmt(r.measures.index, 2)}</td>}
                          {showIndex && <td className={`py-1.5 pr-3 whitespace-nowrap ${r.measures.level ? LEVEL_COLOR[r.measures.level] : ''}`}>{r.measures.level ? BREATH_LEVEL_TEXT[r.measures.level] : '—'}</td>}
                          <td className="py-1.5 pr-3">
                            <select
                              value={r.rating ?? ''}
                              onChange={(e) => void setRating(r, e.target.value === '' ? null : Number(e.target.value))}
                              title="0 – brak powietrza, 3 – bardzo dużo"
                              className="bg-white/70 border border-[#466cd2]/30 rounded px-1 py-0.5 text-[#18388f]"
                            >
                              <option value="">—</option>
                              {[0, 1, 2, 3].map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5"><audio controls preload="none" src={audioUrl(r)} className="h-8 w-[200px]" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                  <p className="text-[12px] text-[#466cd2]">„Na słuch”: 0 – brak powietrza, 1 – trochę, 2 – wyraźnie, 3 – bardzo dużo. Ocena zapisuje się od razu przy nagraniu.</p>
                  <label className="flex items-center gap-2 text-[12px] text-[#466cd2] cursor-pointer">
                    <input type="checkbox" checked={showIndex} onChange={(e) => setShowIndex(e.target.checked)} />
                    pokaż wskaźnik i ocenę według obecnego kryterium (najlepiej po ocenie na słuch)
                  </label>
                </div>
              </LightCard>
            )}
          </>
        )}
      </div>
    </div>
  );
}
