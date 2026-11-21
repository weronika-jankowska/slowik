import { useEffect, useRef, type MutableRefObject } from 'react';
import { LegendItem, MicProblem, PlotCard, StatusRow } from './exerciseUi';
import { useTake } from '../../hooks/useTake';
import { formatDecimalPl, getCalibratedMidiFreq } from '../../utils/noteUtils';
import { makeHnrCollector, measureWindow, medianHnr, type HnrSample } from '../../utils/hnrExercise';

// ---------- Wykres HNR w czasie ----------

const PAD = { left: 46, right: 14, top: 14, bottom: 26 };
const MAX_DB = 30;

function HnrPlot({ samplesRef, durationSec, windowRef }: {
  samplesRef: MutableRefObject<HnrSample[]>;
  durationSec: number;
  /** Zaznaczony fragment pomiaru (null – bez zaznaczenia). */
  windowRef: MutableRefObject<{ from: number; to: number } | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

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
      const x0 = PAD.left, x1 = w - PAD.right, y0 = PAD.top, y1 = h - PAD.bottom;
      const xOf = (t: number) => x0 + (Math.min(Math.max(t, 0), durationSec) / durationSec) * (x1 - x0);
      const yOf = (db: number) => y1 - (Math.max(0, Math.min(MAX_DB, db)) / MAX_DB) * (y1 - y0);

      ctx.font = '11px Cardo, Georgia, serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let d = 0; d <= MAX_DB; d += 5) {
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, yOf(d)); ctx.lineTo(x1, yOf(d)); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(`${d}`, x0 - 8, yOf(d));
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let s = 0; s <= durationSec; s += 1) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(`${s} s`, xOf(s), y1 + 6); }
      ctx.save(); ctx.translate(12, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText('HNR [dB] – im wyżej, tym mniej powietrza', 0, 0); ctx.restore();

      const win = windowRef.current;
      if (win) {
        ctx.fillStyle = 'rgba(52,211,153,.12)';
        ctx.fillRect(xOf(win.from), y0, xOf(win.to) - xOf(win.from), y1 - y0);
        ctx.strokeStyle = 'rgba(52,211,153,.6)'; ctx.setLineDash([4, 4]);
        ctx.strokeRect(xOf(win.from), y0, xOf(win.to) - xOf(win.from), y1 - y0); ctx.setLineDash([]);
        const m = medianHnr(samplesRef.current, win.from, win.to);
        if (Number.isFinite(m)) {
          ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(xOf(win.from), yOf(m)); ctx.lineTo(xOf(win.to), yOf(m)); ctx.stroke();
        }
      }

      const s = samplesRef.current;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [lw, a] of [[8, 0.06], [5, 0.14], [2.4, 1]] as [number, number][]) {
        ctx.globalAlpha = a; ctx.lineWidth = lw; ctx.strokeStyle = 'rgb(52,211,153)';
        ctx.beginPath();
        s.forEach((p, i) => {
          const prev = s[i - 1];
          if (i === 0 || !prev || p.t - prev.t > 0.4) ctx.moveTo(xOf(p.t), yOf(p.hnr)); else ctx.lineTo(xOf(p.t), yOf(p.hnr));
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [samplesRef, windowRef, durationSec]);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}

// ---------- Jedno nagranie z pomiarem HNR ----------

export interface HnrTakeResult { hnr: number; samples: HnrSample[]; window: { from: number; to: number } }

interface HnrTakeProps {
  durationSec: number;
  referenceMidi: number;
  measureFrom: number;
  /** Polecenie w trakcie nagrania, np. „Śpiewaj [A]”. */
  prompt: (t: number) => string;
  onDone: (r: HnrTakeResult) => void;
  onCancel: () => void;
}

/** Nagranie z pomiarem HNR */
export default function HnrTake({ durationSec, referenceMidi, measureFrom, prompt, onDone, onCancel }: HnrTakeProps) {
  const take = useTake();
  const samplesRef = useRef<HnrSample[]>([]);
  const windowRef = useRef<{ from: number; to: number } | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const collector = makeHnrCollector();
    samplesRef.current = collector.samples;
    windowRef.current = null;
    void take.run({
      maxSec: durationSec,
      referenceMidi,
      targetHz: getCalibratedMidiFreq(referenceMidi),
      onFrame: collector.onFrame,
      onDone: (frames) => {
        // bez ataku dźwięku (0,4 s), dla „mmm → aaa”
        const win = measureWindow(frames, measureFrom);
        const from = Math.max(win.from, (frames.find((f) => f.f0 !== null)?.t ?? 0) + 0.4);
        const window = { from, to: win.to };
        windowRef.current = window;
        doneRef.current({ hnr: medianHnr(collector.samples, window.from, window.to), samples: collector.samples, window });
      }
    });
    return () => take.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = samplesRef.current[samplesRef.current.length - 1];
  return (
    <>
      <PlotCard
        countdown={take.phase === 'countdown' ? take.countdown : null}
        plot={<HnrPlot samplesRef={samplesRef} durationSec={durationSec} windowRef={windowRef} />}
        legend={take.phase === 'done' ? (
          <>
            <LegendItem swatch="w-6 h-[3px] rounded bg-emerald-400">HNR w czasie</LegendItem>
            <LegendItem swatch="w-4 h-3 bg-emerald-400/20 border border-dashed border-emerald-400/70">fragment pomiaru i jego mediana</LegendItem>
          </>
        ) : undefined}
      >
        {take.phase === 'recording' && (
          <StatusRow
            left={{ label: 'HNR teraz', value: last && take.elapsed - last.t < 0.5 ? `${formatDecimalPl(last.hnr, 1)} dB` : '—' }}
            center={!take.started ? 'Zaśpiewaj dźwięk' : prompt(take.elapsed)}
            centerClass="text-emerald-300"
            right={{ label: 'Twój głos', value: take.live?.f0 ? `${formatDecimalPl(take.live.f0, 1)} Hz` : '--- Hz' }}
            progress={take.elapsed / durationSec}
            progressText={`${formatDecimalPl(take.elapsed, 1)} / ${durationSec} s`}
            button={{ label: 'Anuluj', onClick: () => { take.cancel(); onCancel(); } }}
          />
        )}
      </PlotCard>
      <MicProblem state={take.micState} />
    </>
  );
}
