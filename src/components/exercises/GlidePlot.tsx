import { useEffect, useRef, type MutableRefObject } from 'react';
import type { GlideData, MpfrRange } from '../../utils/yawnSighExercise';

interface GlidePlotProps {
  /** Bieżąca próba – czytana z refa w każdej klatce animacji. */
  dataRef: MutableRefObject<GlideData>;
  /** Wcześniejsze próby z tej sesji – rysowane blado w tle. */
  previous: GlideData[];
  /** Zakres głosu z analizy (MPFR) – zaznaczany jako pas w tle. */
  mpfr: MpfrRange | null;
  durationSec: number;
  minMidi?: number;
  maxMidi?: number;
  /** Funkcja nazw dźwięków (z noteUtils), np. 57 → „A3”. */
  noteName: (midi: number) => string;
  running: boolean;
}

type RGB = [number, number, number];
const C_MAIN: RGB = [52, 211, 153]; // emerald-400, jak w pozostałych wykresach
const C_ABOVE: RGB = [255, 122, 198]; // róż z ikon – fragment ponad zakresem z analizy
const rgb = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const PAD = { left: 46, right: 14, top: 14, bottom: 26 };

export default function GlidePlot({ dataRef, previous, mpfr, durationSec, minMidi = 36, maxMidi = 88, noteName, running }: GlidePlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ previous, mpfr, durationSec, minMidi, maxMidi, noteName, running });
  propsRef.current = { previous, mpfr, durationSec, minMidi, maxMidi, noteName, running };

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = box.clientWidth;
      height = box.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    let raf = 0;
    const draw = () => {
      const { previous: prev, mpfr: range, durationSec: dur, minMidi: lo, maxMidi: hi, noteName: name, running: isRunning } = propsRef.current;
      const data = dataRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const x0 = PAD.left;
      const x1 = width - PAD.right;
      const y0 = PAD.top;
      const y1 = height - PAD.bottom;
      const xOf = (t: number) => x0 + (Math.min(Math.max(t, 0), dur) / dur) * (x1 - x0);
      const yOf = (m: number) => y0 + ((hi - Math.max(lo, Math.min(hi, m))) / (hi - lo)) * (y1 - y0);

      // siatka: linie na każdym C (z opisem) i delikatniej na G
      ctx.font = '11px Cardo, Georgia, serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let m = Math.ceil(lo); m <= hi; m++) {
        const pc = ((m % 12) + 12) % 12;
        if (pc !== 0 && pc !== 7) continue;
        const y = yOf(m);
        ctx.strokeStyle = pc === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        if (pc === 0) {
          ctx.fillStyle = 'rgba(255,255,255,.55)';
          ctx.fillText(name(m), x0 - 8, y);
        }
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let s = 0; s <= dur + 1e-6; s += 1) {
        const x = xOf(s);
        ctx.strokeStyle = 'rgba(255,255,255,.06)';
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillText(`${s} s`, x, y1 + 6);
      }
      ctx.save();
      ctx.translate(12, (y0 + y1) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText('wysokość dźwięku', 0, 0);
      ctx.restore();

      // zakres z analizy głosu
      if (range) {
        const ry0 = yOf(range.highMidi), ry1 = yOf(range.lowMidi);
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x0, ry0, x1 - x0, ry1 - ry0);
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,.45)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, ry0); ctx.lineTo(x1, ry0); ctx.stroke();
        ctx.setLineDash([]);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.fillText(`najwyższy dźwięk z analizy głosu: ${name(Math.round(range.highMidi))}`, x1 - 6, ry0 - 3);
      }

      const segmentsOf = (d: GlideData) => {
        const out: { xa: number; ya: number; xb: number; yb: number; above: boolean }[] = [];
        for (let i = 1; i < d.t.length; i++) {
          const a = d.midi[i - 1] ?? NaN, b = d.midi[i] ?? NaN;
          const ta = d.t[i - 1] ?? 0, tb = d.t[i] ?? 0;
          if (!Number.isFinite(a) || !Number.isFinite(b) || tb - ta > 0.12) continue;
          out.push({ xa: xOf(ta), ya: yOf(a), xb: xOf(tb), yb: yOf(b), above: !!range && Math.max(a, b) > range.highMidi + 0.5 });
        }
        return out;
      };

      // wcześniejsze próby – blado
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.lineWidth = 1.6;
      for (const p of prev) {
        ctx.beginPath();
        for (const s of segmentsOf(p)) { ctx.moveTo(s.xa, s.ya); ctx.lineTo(s.xb, s.yb); }
        ctx.stroke();
      }

      // bieżąca próba
      const segs = segmentsOf(data);
      const passes: [number, number][] = [[9, 0.05], [5.5, 0.12], [2.6, 1]];
      for (const [w, alpha] of passes) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = w;
        for (const s of segs) {
          ctx.strokeStyle = rgb(s.above ? C_ABOVE : C_MAIN);
          ctx.beginPath(); ctx.moveTo(s.xa, s.ya); ctx.lineTo(s.xb, s.yb); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      let peakI = -1, lastI = -1;
      for (let i = 0; i < data.t.length; i++) {
        const m = data.midi[i] ?? NaN;
        if (!Number.isFinite(m)) continue;
        lastI = i;
        if (peakI < 0 || m > (data.midi[peakI] ?? -Infinity)) peakI = i;
      }
      const nowT = data.t[data.t.length - 1] ?? 0;
      if (isRunning && lastI >= 0 && nowT - (data.t[lastI] ?? 0) < 0.15) {
        const m = data.midi[lastI] ?? 0;
        const c = range && m > range.highMidi + 0.5 ? C_ABOVE : C_MAIN;
        ctx.save();
        ctx.shadowColor = rgb(c);
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(xOf(data.t[lastI] ?? 0), yOf(m), 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (!isRunning && peakI >= 0) {
        const m = data.midi[peakI] ?? 0;
        const px = xOf(data.t[peakI] ?? 0), py = yOf(m);
        const c = range && m > range.highMidi + 0.5 ? C_ABOVE : C_MAIN;
        ctx.save();
        ctx.shadowColor = rgb(c);
        ctx.shadowBlur = 16;
        ctx.fillStyle = rgb(c);
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.font = '13px Cardo, Georgia, serif';
        ctx.textAlign = px > (x0 + x1) / 2 ? 'right' : 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = rgb(c);
        ctx.fillText(name(Math.round(m)), px + (px > (x0 + x1) / 2 ? -9 : 9), py - 4);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [dataRef]);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}