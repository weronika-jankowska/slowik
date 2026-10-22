import { useEffect, useRef, type MutableRefObject } from 'react';
import type { AttemptData } from '../../utils/vibratoExercise';

interface PitchPlotProps {
  /** Dane rysowane „na żywo”: komponent czyta je z refa w każdej klatce animacji. */
  dataRef: MutableRefObject<AttemptData>;
  durationSec: number;
  /** Połowa szerokości zielonego pasma w centach (pasmo: −band … +band). */
  bandCents: number;
  /** Zakres osi pionowej: −range … +range centów. */
  rangeCents?: number;
  bandLabel: string;
  targetLabel: string;
  /** Czy pokazywać „głowicę” (bieżący punkt). */
  running: boolean;
}

const GREEN = '74, 222, 128';
const PAD = { left: 46, right: 14, top: 14, bottom: 26 };

export default function PitchPlot({ dataRef, durationSec, bandCents, rangeCents = 50, bandLabel, targetLabel, running }: PitchPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ durationSec, bandCents, rangeCents, bandLabel, targetLabel, running });
  propsRef.current = { durationSec, bandCents, rangeCents, bandLabel, targetLabel, running };

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
      const { durationSec: dur, bandCents: band, rangeCents: range, bandLabel: bLabel, targetLabel: tLabel, running: isRunning } = propsRef.current;
      const data = dataRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const x0 = PAD.left;
      const x1 = width - PAD.right;
      const y0 = PAD.top;
      const y1 = height - PAD.bottom;
      const xOf = (t: number) => x0 + (Math.min(Math.max(t, 0), dur) / dur) * (x1 - x0);
      const yOf = (c: number) => y0 + ((range - Math.max(-range * 1.04, Math.min(range * 1.04, c))) / (2 * range)) * (y1 - y0);

      // czy ostatni punkt jest w pasmie (podświetlenie)
      let lastIdx = -1;
      for (let i = data.t.length - 1; i >= 0 && i >= data.t.length - 12; i--) {
        if (Number.isFinite(data.cents[i] ?? NaN)) { lastIdx = i; break; }
      }
      const lastCents = lastIdx >= 0 ? (data.cents[lastIdx] ?? NaN) : NaN;
      const lastT = lastIdx >= 0 ? (data.t[lastIdx] ?? 0) : 0;
      const nowT = data.t.length > 0 ? (data.t[data.t.length - 1] ?? 0) : 0;
      const live = isRunning && lastIdx >= 0 && nowT - lastT < 0.15;
      const inBandNow = live && Math.abs(lastCents) <= band;

      // siatka i opisy osi
      ctx.font = '11px Cardo, Georgia, serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (const c of [-50, -25, 0, 25, 50]) {
        if (Math.abs(c) > range) continue;
        const y = yOf(c);
        ctx.strokeStyle = c === 0 ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.10)';
        ctx.setLineDash(c === 0 ? [5, 4] : []);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillText(c === 0 ? '0' : `${c > 0 ? '+' : '−'}${Math.abs(c)}`, x0 - 8, y);
      }
      ctx.setLineDash([]);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tickEvery = dur > 12 ? 5 : 2;
      for (let s = 0; s <= dur + 1e-6; s += tickEvery) {
        const x = xOf(s);
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
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
      ctx.fillText(`centy względem dźwięku ${tLabel}`, 0, 0);
      ctx.restore();

      // zielone pasmo (rozjaśnia się, gdy głos jest w środku)
      const bTop = yOf(band);
      const bBot = yOf(-band);
      ctx.save();
      if (inBandNow) { ctx.shadowColor = `rgba(${GREEN}, .85)`; ctx.shadowBlur = 22; }
      ctx.fillStyle = `rgba(${GREEN}, ${inBandNow ? 0.36 : 0.17})`;
      ctx.fillRect(x0, bTop, x1 - x0, bBot - bTop);
      ctx.restore();
      ctx.strokeStyle = `rgba(${GREEN}, ${inBandNow ? 0.95 : 0.55})`;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x0 + 0.5, bTop + 0.5, x1 - x0 - 1, bBot - bTop - 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = `rgba(190, 255, 215, ${inBandNow ? 1 : 0.85})`;
      ctx.fillText(bLabel, x0 + 8, bTop - 3);

      // tor f0: odcinki między kolejnymi ramkami, kolor zależny od położenia względem pasma
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      for (let i = 1; i < data.t.length; i++) {
        const c1 = data.cents[i] ?? NaN;
        const c0 = data.cents[i - 1] ?? NaN;
        if (!Number.isFinite(c1) || !Number.isFinite(c0)) continue;
        const t1 = data.t[i] ?? 0;
        const t0 = data.t[i - 1] ?? 0;
        if (t1 - t0 > 0.12) continue;
        const a = Math.abs(c1);
        ctx.strokeStyle = a <= band ? `rgb(${GREEN})` : a <= 2 * band ? 'rgb(251, 191, 36)' : 'rgb(251, 113, 133)';
        ctx.beginPath(); ctx.moveTo(xOf(t0), yOf(c0)); ctx.lineTo(xOf(t1), yOf(c1)); ctx.stroke();
      }

      // znaczniki, gdy dźwięk jest poza zakresem osi
      if (live && Math.abs(lastCents) > range) {
        const up = lastCents > 0;
        const x = xOf(lastT);
        const y = up ? y0 + 6 : y1 - 6;
        ctx.fillStyle = 'rgb(251, 113, 133)';
        ctx.beginPath();
        ctx.moveTo(x, y + (up ? -5 : 5)); ctx.lineTo(x - 6, y + (up ? 5 : -5)); ctx.lineTo(x + 6, y + (up ? 5 : -5)); ctx.closePath(); ctx.fill();
      }

      // głowica
      if (live) {
        const hx = xOf(lastT);
        const hy = yOf(lastCents);
        ctx.save();
        ctx.shadowColor = inBandNow ? `rgba(${GREEN}, 1)` : 'rgba(255,255,255,.8)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
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
