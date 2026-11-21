import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  BTN,
  BTN_PRIMARY,
  ExercisePage,
  Instructions,
  LegendItem,
  LightCard,
  MicProblem,
  PlotCard,
  ResultActions,
  ResultHeader,
  ResultTiles,
  Segmented,
  StatusRow
} from './exerciseUi';
import { useTake } from '../../hooks/useTake';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName, playReferenceNote, centsBetween } from '../../utils/noteUtils';
import {
  BAND_CENTERS,
  PowerAccumulator,
  SECTION_LABEL,
  analyzeFile,
  bandsFromPower,
  compareTimbre,
  loadReferences,
  saveReference,
  timbreFeedback,
  type Section,
  type TimbreReference
} from '../../utils/timbre';

const TAKE_SEC = 6;
const FLOOR = -40;

// ---------- Wykres pasm

function TimbrePlot({ userRef, reference }: { userRef: MutableRefObject<number[] | null>; reference: number[] | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const refRef = useRef(reference);
  refRef.current = reference;

  useEffect(() => {
    const canvas = canvasRef.current, box = boxRef.current;
    if (!canvas || !box) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = box.clientWidth; h = box.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    let raf = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const x0 = 46, x1 = w - 14, y0 = 14, y1 = h - 26;
      const n = BAND_CENTERS.length, slot = (x1 - x0) / n;
      const yOf = (db: number) => y0 + (Math.min(0, Math.max(FLOOR, db)) / FLOOR) * (y1 - y0);
      ctx.font = '11px Cardo, Georgia, serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let d = 0; d >= FLOOR; d -= 10) {
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.beginPath(); ctx.moveTo(x0, yOf(d)); ctx.lineTo(x1, yOf(d)); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(d === 0 ? '0' : `−${-d}`, x0 - 8, yOf(d));
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      BAND_CENTERS.forEach((fc, i) => {
        if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(fc >= 1000 ? `${fc / 1000}k` : `${fc}`, x0 + slot * (i + 0.5), y1 + 6); }
      });
      // obszar „blasku” 2–5 kHz – delikatnie wyróżniony
      const hiStart = BAND_CENTERS.findIndex((f) => f >= 2000);
      ctx.fillStyle = 'rgba(255,255,255,.04)';
      ctx.fillRect(x0 + slot * hiStart, y0, x1 - (x0 + slot * hiStart), y1 - y0);

      const user = userRef.current, ref = refRef.current;
      if (user) {
        user.forEach((v, i) => {
          const x = x0 + slot * i + slot * 0.18;
          ctx.fillStyle = 'rgba(52,211,153,.55)';
          ctx.fillRect(x, yOf(v), slot * 0.64, y1 - yOf(v));
        });
      }
      if (ref) {
        ctx.strokeStyle = 'rgba(255,190,230,.95)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ref.forEach((v, i) => {
          const xa = x0 + slot * i + slot * 0.1, xb = x0 + slot * (i + 1) - slot * 0.1;
          if (i === 0) ctx.moveTo(xa, yOf(v)); else ctx.lineTo(xa, yOf(v));
          ctx.lineTo(xb, yOf(v));
        });
        ctx.stroke();
      }
      ctx.save(); ctx.translate(12, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText('poziom pasma [dB]', 0, 0); ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [userRef]);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}

const makeDb = (n: number) => new Float32Array(n);

// ---------- Ćwiczenie ----------

type Mode = 'reference' | 'user';
type Fb = ReturnType<typeof timbreFeedback>;

export default function TimbreExercise({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<Section>('A');
  const [refs, setRefs] = useState(loadReferences);
  const [mode, setMode] = useState<Mode | null>(null);
  const [feedback, setFeedback] = useState<Fb | null>(null);
  const [fileState, setFileState] = useState<'idle' | 'busy' | 'error'>('idle');
  const take = useTake();
  const userBandsRef = useRef<number[] | null>(null);
  const accRef = useRef(new PowerAccumulator());
  const dbRef = useRef<ReturnType<typeof makeDb> | null>(null);
  const f0sRef = useRef<number[]>([]);
  const binHzRef = useRef(0);
  const lastBandsRef = useRef(0);

  const reference = refs[section] ?? null;
  const refMidi = reference && Number.isFinite(reference.f0)
    ? Math.round(69 + centsBetween(reference.f0, getCalibratedMidiFreq(69)) / 100)
    : null;

  const record = (m: Mode) => {
    setMode(m);
    setFeedback(null);
    accRef.current = new PowerAccumulator();
    userBandsRef.current = null;
    f0sRef.current = [];
    void take.run({
      maxSec: TAKE_SEC,
      referenceMidi: m === 'user' ? refMidi : null,
      countdown: true,
      onFrame: (f, analyser) => {
        if (!analyser || f.f0 === null || f.t < 0.3) return; // bez ataku dźwięku
        const n = analyser.frequencyBinCount;
        if (!dbRef.current || dbRef.current.length !== n) dbRef.current = makeDb(n);
        analyser.getFloatFrequencyData(dbRef.current);
        accRef.current.add(dbRef.current);
        binHzRef.current = analyser.context.sampleRate / 2 / n;
        f0sRef.current.push(f.f0);
        if (f.t - lastBandsRef.current > 0.15 && accRef.current.pow) {
          lastBandsRef.current = f.t;
          userBandsRef.current = bandsFromPower(accRef.current.pow, binHzRef.current);
        }
      },
      onDone: () => {
        const acc = accRef.current;
        if (!acc.pow || acc.frames < 20) { setFeedback(null); return; }
        const bands = bandsFromPower(acc.pow, binHzRef.current);
        userBandsRef.current = bands;
        if (m === 'reference') {
          const f0s = f0sRef.current.slice().sort((a, b) => a - b);
          const ref: TimbreReference = { bands, f0: f0s[f0s.length >> 1] ?? NaN, source: 'mic', label: 'nagranie z mikrofonu', savedAt: new Date().toLocaleDateString('pl-PL') };
          saveReference(section, ref);
          setRefs(loadReferences());
        } else if (reference) {
          setFeedback(timbreFeedback(compareTimbre(bands, reference.bands), SECTION_LABEL[section]));
        }
      }
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileState('busy');
    const r = await analyzeFile(file);
    if (!r) { setFileState('error'); return; }
    saveReference(section, { bands: r.bands, f0: r.f0, source: 'file', label: file.name, savedAt: new Date().toLocaleDateString('pl-PL') });
    setRefs(loadReferences());
    setFileState('idle');
  };

  const recording = take.phase === 'countdown' || take.phase === 'recording';
  const showPlot = recording || take.phase === 'done' || !!reference;

  return (
    <ExercisePage kicker="Ćwiczenie dla chórzystów" title="Dopasuj barwę" subtitle={`wzorzec sekcji: ${SECTION_LABEL[section]}`} onBack={() => { take.cancel(); onBack(); }}>
      {showPlot && (
        <PlotCard
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={<TimbrePlot userRef={userBandsRef} reference={mode === 'reference' && recording ? null : reference?.bands ?? null} />}
          legend={
            <>
              <LegendItem swatch="w-5 h-3 rounded-sm bg-emerald-400/60">{mode === 'reference' ? 'nagrywany wzorzec' : 'Twój głos'}</LegendItem>
              {reference && <LegendItem swatch="w-6 h-[2px] bg-[#ffbee6]">wzorzec sekcji</LegendItem>}
              <LegendItem swatch="w-4 h-3 bg-white/10">obszar „blasku” 2–5 kHz</LegendItem>
            </>
          }
        >
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Nagrywanie', value: mode === 'reference' ? 'wzorzec' : 'Twój głos' }}
              center={!take.started ? 'Zaśpiewaj [A]' : take.live?.f0 ? 'Śpiewaj równo [A]' : 'Brak dźwięku…'}
              centerClass="text-emerald-300"
              right={{ label: 'Głos', value: take.live?.f0 ? `${formatDecimalPl(take.live.f0, 1)} Hz` : '--- Hz' }}
              progress={take.elapsed / TAKE_SEC}
              progressText={`${formatDecimalPl(take.elapsed, 1)} / ${TAKE_SEC} s`}
              button={{ label: 'Anuluj', onClick: take.cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={take.micState} />

      {!recording && (
        <LightCard className="max-w-3xl flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider opacity-70">Twoja sekcja</span>
            <Segmented value={section} onChange={(s) => { setSection(s); setFeedback(null); take.reset(); userBandsRef.current = null; }}
              options={(['S', 'A', 'T', 'B'] as Section[]).map((s) => ({ id: s, label: SECTION_LABEL[s] }))} />
          </div>
          <Instructions
            steps={[
              reference
                ? `Wzorzec sekcji: ${reference.label} (${reference.savedAt})${refMidi !== null ? `, dźwięk ok. ${midiToNoteName(refMidi)}` : ''}.`
                : 'Najpierw dodaj wzorzec sekcji: wczytaj nagranie (np. prowadzącego sekcję śpiewającego [A]) albo nagraj je mikrofonem.',
              `Potem zaśpiewaj [A] przez ${TAKE_SEC} sekund${refMidi !== null ? ' na dźwięku wzorca (usłyszysz go przed odliczaniem)' : ''}. Aplikacja porówna barwę obu nagrań w pasmach częstotliwości.`,
              'Próbuj różnych ustawień (więcej przestrzeni w ustach, jaśniej, ciemniej) i obserwuj, jak zielone słupki zbliżają się do linii wzorca.'
            ]}
            note="Do porównania potrzebna jest ta sama samogłoska i podobna wysokość dźwięku. Wzorce są zapisywane tylko w tej przeglądarce."
          />
          <div className="flex flex-wrap items-center justify-center sm:justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <label className={`${BTN} inline-flex items-center`}>
                {fileState === 'busy' ? 'Analiza pliku…' : 'Wczytaj wzorzec z pliku'}
                <input type="file" accept="audio/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => record('reference')} className={BTN}>Nagraj wzorzec</button>
              {refMidi !== null && <button type="button" onClick={() => playReferenceNote(refMidi)} className={BTN}>♪ Dźwięk wzorca</button>}
            </div>
            <button type="button" onClick={() => record('user')} disabled={!reference} className={BTN_PRIMARY}>Zaśpiewaj i porównaj</button>
          </div>
          {fileState === 'error' && <p className="text-[13px] text-rose-700 text-center">Nie udało się odczytać pliku – użyj nagrania audio (np. mp3, wav, m4a) ze śpiewem.</p>}
          {take.phase === 'done' && mode === 'reference' && <p className="text-[13px] text-emerald-800 text-center">Wzorzec zapisany. Teraz zaśpiewaj i porównaj swoją barwę.</p>}
        </LightCard>
      )}

      {take.phase === 'done' && mode === 'user' && feedback && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={feedback.tone} headline={feedback.headline} detail={feedback.detail} />
          <ResultTiles rows={feedback.rows} colors={{ sim: '#2f8f5b', low: '#256899', mid: '#8234c7', high: '#c0396b' }} />
          <ResultActions>
            <button type="button" onClick={() => record('user')} className={BTN_PRIMARY}>Spróbuj jeszcze raz</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </ExercisePage>
  );
}
