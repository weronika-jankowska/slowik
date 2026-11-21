import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  BTN,
  BTN_PRIMARY,
  ExercisePage,
  Instructions,
  LegendItem,
  MicProblem,
  NotePicker,
  PlotCard,
  ResultActions,
  ResultHeader,
  ResultTiles,
  SetupCard,
  StatusRow,
  readMpfrRange
} from './exerciseUi';
import { useTake, type TakeFrame } from '../../hooks/useTake';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName, playReferenceNote } from '../../utils/noteUtils';
import { MESSA_SEC, analyzeMessa, loudnessCurve, messaFeedback, messaTarget, type Feedback } from '../../utils/popExercises';

const FLOOR_DB = -40;
/** Głębokość docelowego łuku na wykresie [dB] */
const TARGET_DEPTH = 20;


function DynamicsPlot({ framesRef, running }: { framesRef: MutableRefObject<TakeFrame[]>; running: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;

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
    let cache = { n: -1, t: [] as number[], db: [] as number[] };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const x0 = 46, x1 = w - 14, y0 = 14, y1 = h - 26;
      const xOf = (t: number) => x0 + (Math.min(Math.max(t, 0), MESSA_SEC) / MESSA_SEC) * (x1 - x0);
      const yOf = (db: number) => y0 + (Math.min(0, Math.max(FLOOR_DB, db)) / FLOOR_DB) * (y1 - y0);

      ctx.font = '11px Cardo, Georgia, serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let d = 0; d >= FLOOR_DB; d -= 10) {
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.beginPath(); ctx.moveTo(x0, yOf(d)); ctx.lineTo(x1, yOf(d)); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(d === 0 ? '0' : `−${-d}`, x0 - 8, yOf(d));
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let s = 0; s <= MESSA_SEC; s += 2) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(`${s} s`, xOf(s), y1 + 6); }
      ctx.save(); ctx.translate(12, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText('głośność względem szczytu [dB]', 0, 0); ctx.restore();

      // docelowy łuk: cicho – głośno – cicho
      ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,190,230,.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) { const t = (k / 40) * MESSA_SEC; const y = yOf(messaTarget(t, TARGET_DEPTH)); if (k === 0) ctx.moveTo(xOf(t), y); else ctx.lineTo(xOf(t), y); }
      ctx.stroke(); ctx.setLineDash([]);

      const frames = framesRef.current;
      if (frames.length !== cache.n) { const c = loudnessCurve(frames); cache = { n: frames.length, t: c.t, db: c.db }; }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [lw, a] of [[9, 0.05], [5.5, 0.12], [2.6, 1]] as [number, number][]) {
        ctx.globalAlpha = a; ctx.lineWidth = lw; ctx.strokeStyle = 'rgb(52,211,153)';
        ctx.beginPath();
        let pen = false;
        cache.db.forEach((d, i) => {
          if (!Number.isFinite(d)) { pen = false; return; }
          const x = xOf(cache.t[i] ?? 0), y = yOf(d);
          if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (runningRef.current) {
        const last = frames[frames.length - 1];
        if (last) {
          ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(xOf(last.t), y0); ctx.lineTo(xOf(last.t), y1); ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [framesRef]);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}

// ---------- Ćwiczenie ----------

const MIN_MIDI = 40;
const MAX_MIDI = 79;

export default function MessaDiVoceExercise({ onBack }: { onBack: () => void }) {
  const [mpfr] = useState(readMpfrRange);
  const [midi, setMidi] = useState(() => (mpfr ? Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(mpfr.lowMidi + (mpfr.highMidi - mpfr.lowMidi) * 0.4))) : 55));
  const [fb, setFb] = useState<Feedback | null>(null);
  const take = useTake();
  const targetHz = useMemo(() => getCalibratedMidiFreq(midi), [midi]);

  const start = () => {
    setFb(null);
    void take.run({
      maxSec: MESSA_SEC,
      referenceMidi: midi,
      targetHz,
      quietNearTarget: true,
      onDone: (frames) => setFb(messaFeedback(analyzeMessa(frames)))
    });
  };

  const half = take.elapsed < MESSA_SEC / 2;
  const live = take.live;

  return (
    <ExercisePage kicker="Ćwiczenie dla śpiewaków rozrywkowych" title="Messa di voce" subtitle="piano – forte – piano na jednym dźwięku" onBack={() => { take.cancel(); onBack(); }}>
      {take.phase !== 'idle' && (
        <PlotCard
          countdown={take.phase === 'countdown' ? take.countdown : null}
          plot={<DynamicsPlot framesRef={take.framesRef} running={take.phase === 'recording'} />}
          legend={
            <>
              <LegendItem swatch="w-6 h-[3px] rounded bg-emerald-400">Twoja głośność</LegendItem>
              <LegendItem swatch="w-6 h-0 border-t-2 border-dashed border-[#ffbee6]">wzorcowy łuk</LegendItem>
            </>
          }
        >
          {take.phase === 'recording' && (
            <StatusRow
              left={{ label: 'Cel', value: `${midiToNoteName(midi)} (${formatDecimalPl(targetHz, 1)} Hz)` }}
              center={!take.started ? 'Zacznij bardzo cicho' : half ? 'Narastaj ↑' : 'Wyciszaj ↓'}
              centerClass="text-emerald-300"
              centerSub={live && Number.isFinite(live.cents) ? `${live.cents > 0 ? '+' : ''}${Math.round(live.cents)} centów` : '—'}
              right={{ label: 'Twój głos', value: live?.f0 ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz' }}
              progress={take.elapsed / MESSA_SEC}
              progressText={`${formatDecimalPl(take.elapsed, 1)} / ${MESSA_SEC} s`}
              button={{ label: take.started ? 'Zakończ' : 'Anuluj', onClick: take.started ? take.stop : take.cancel }}
            />
          )}
        </PlotCard>
      )}
      <MicProblem state={take.micState} />

      {take.phase === 'idle' && (
        <SetupCard>
          <Instructions
            steps={[
              'Usłyszysz dźwięk wzorcowy. Po odliczaniu zacznij śpiewać go bardzo cicho na samogłosce <i>a</i>.',
              `Przez pierwsze ${MESSA_SEC / 2} sekund stopniowo narastaj do pełnego, ale nie krzyczanego forte, a przez kolejne ${MESSA_SEC / 2} sekund równie płynnie wyciszaj.`,
              'Wysokość dźwięku ma zostać ta sama od początku do końca – zmienia się tylko głośność.'
            ]}
            note="Nie zmieniaj odległości od mikrofonu w trakcie ćwiczenia."
            numbered={false}
          />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <NotePicker midi={midi} onChange={setMidi} min={MIN_MIDI} max={MAX_MIDI} label="Dźwięk wzorcowy" sub={`${formatDecimalPl(targetHz, 1)} Hz`} noteName={midiToNoteName} />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => playReferenceNote(midi)} className={BTN}>♪ Posłuchaj dźwięku</button>
              <button type="button" onClick={start} className={BTN_PRIMARY}>Rozpocznij</button>
            </div>
          </div>
        </SetupCard>
      )}

      {take.phase === 'done' && fb && (
        <div className="w-full flex flex-col items-center gap-4">
          <ResultHeader tone={fb.tone} headline={fb.headline} detail={fb.detail} />
          <ResultTiles rows={fb.rows} colors={{ range: '#2f8f5b', shape: '#256899', peak: '#cc8822', pitch: '#8234c7' }} />
          <ResultActions>
            <button type="button" onClick={start} className={BTN_PRIMARY}>Powtórz</button>
            <button type="button" onClick={take.reset} className={BTN}>Zmień dźwięk</button>
            <button type="button" onClick={onBack} className={BTN}>Wróć do ćwiczeń</button>
          </ResultActions>
        </div>
      )}
    </ExercisePage>
  );
}
