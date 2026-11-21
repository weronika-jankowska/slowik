import { useEffect, useRef, type MutableRefObject } from 'react';
import type { AttemptData } from '../../utils/vibratoExercise';

interface PitchPlotProps {
  /** Dane rysowane „na żywo” */
  dataRef: MutableRefObject<AttemptData>;
  durationSec: number;
  bandCents: number;
  /** Zakres osi pionowej: −range … +range centów. */
  rangeCents?: number;
  bandLabel?: string;
  targetLabel: string;
  /** Czy pokazywać „głowicę” (bieżący punkt). */
  running: boolean;
  backgroundRef?: MutableRefObject<{ t: number[]; cents: number[] }>;
  zones?: { t0: number; t1: number; label: string; accent: boolean }[];
}

const GREEN = '52, 211, 153'; // emerald-400, jak w analizie głosu

type RGB = [number, number, number];
const C_GOOD: RGB = [52, 211, 153]; // w pasmie
const C_MID: RGB = [250, 204, 21]; // yellow-400, jak w analizie głosu
const C_BAD: RGB = [244, 63, 94]; // nasycony czerwony

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgbStr = (c: RGB) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/** Płynny kolor zależny od odległości od dźwięku */
function colorForCents(absCents: number, band: number): RGB {
  if (absCents <= band) return C_GOOD;
  if (absCents <= 2 * band) return mix(C_GOOD, C_MID, (absCents - band) / band);
  if (absCents <= 3 * band) return mix(C_MID, C_BAD, (absCents - 2 * band) / band);
  return C_BAD;
}
const PAD = { left: 46, right: 14, top: 14, bottom: 26 };

export default function PitchPlot({ dataRef, durationSec, bandCents, rangeCents = 50, bandLabel, targetLabel, running, backgroundRef, zones }: PitchPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ durationSec, bandCents, rangeCents, bandLabel, targetLabel, running, zones });
  propsRef.current = { durationSec, bandCents, rangeCents, bandLabel, targetLabel, running, zones };

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
      const gridStep = range > 60 ? 50 : 25;
      const gridLines: number[] = [];
      for (let c = -Math.floor(range / gridStep) * gridStep; c <= range; c += gridStep) gridLines.push(c);
      for (const c of gridLines) {
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

      // odcinki czasu z podpisami (tło + opis u góry odcinka)
      const zs = propsRef.current.zones;
      if (zs) {
        ctx.font = '11px Cardo, Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const z of zs) {
          const za = xOf(z.t0), zb = xOf(z.t1);
          ctx.fillStyle = z.accent ? 'rgba(255,122,198,.10)' : 'rgba(255,255,255,.04)';
          ctx.fillRect(za, y0, zb - za, y1 - y0);
          ctx.fillStyle = z.accent ? 'rgba(255,190,230,.9)' : 'rgba(255,255,255,.7)';
          ctx.fillText(z.label, (za + zb) / 2, y0 + 4);
        }
      }

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
      if (bLabel) ctx.fillText(bLabel, x0 + 8, bTop - 3);

      // cienka linia w tle (np. surowe f0 z wibratem)
      const bg = backgroundRef?.current;
      if (bg && bg.t.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.38)';
        ctx.lineWidth = 1.2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let penDown = false;
        for (let i = 0; i < bg.t.length; i++) {
          const c = bg.cents[i] ?? NaN;
          const t = bg.t[i] ?? 0;
          const gap = i > 0 && t - (bg.t[i - 1] ?? 0) > 0.12;
          if (!Number.isFinite(c) || gap) { penDown = false; if (!Number.isFinite(c)) continue; }
          if (penDown) ctx.lineTo(xOf(t), yOf(c)); else { ctx.moveTo(xOf(t), yOf(c)); penDown = true; }
        }
        ctx.stroke();
      }

      // tor f0
      type Seg = { x0: number; y0: number; x1: number; y1: number; grad: CanvasGradient };
      const segs: Seg[] = [];
      for (let i = 1; i < data.t.length; i++) {
        const c1 = data.cents[i] ?? NaN;
        const c0 = data.cents[i - 1] ?? NaN;
        if (!Number.isFinite(c1) || !Number.isFinite(c0)) continue;
        const t1 = data.t[i] ?? 0;
        const t0 = data.t[i - 1] ?? 0;
        if (t1 - t0 > 0.12) continue;
        const sx0 = xOf(t0), sy0 = yOf(c0), sx1 = xOf(t1), sy1 = yOf(c1);
        const grad = ctx.createLinearGradient(sx0, sy0, sx1, sy1);
        grad.addColorStop(0, rgbStr(colorForCents(Math.abs(c0), band)));
        grad.addColorStop(1, rgbStr(colorForCents(Math.abs(c1), band)));
        segs.push({ x0: sx0, y0: sy0, x1: sx1, y1: sy1, grad });
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // poświata
      const passes: [number, number][] = [[9, 0.05], [5.5, 0.12], [2.6, 1]];
      for (const [w, alpha] of passes) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = w;
        for (const sg of segs) {
          ctx.strokeStyle = sg.grad;
          ctx.beginPath(); ctx.moveTo(sg.x0, sg.y0); ctx.lineTo(sg.x1, sg.y1); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // znaczniki, gdy dźwięk jest poza zakresem osi
      if (live && Math.abs(lastCents) > range) {
        const up = lastCents > 0;
        const x = xOf(lastT);
        const y = up ? y0 + 6 : y1 - 6;
        ctx.fillStyle = rgbStr(C_BAD);
        ctx.beginPath();
        ctx.moveTo(x, y + (up ? -5 : 5)); ctx.lineTo(x - 6, y + (up ? 5 : -5)); ctx.lineTo(x + 6, y + (up ? 5 : -5)); ctx.closePath(); ctx.fill();
      }

      // głowica
      if (live) {
        const hx = xOf(lastT);
        const hy = yOf(lastCents);
        ctx.save();
        const headColor = rgbStr(colorForCents(Math.abs(lastCents), band));
        ctx.shadowColor = headColor;
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [dataRef, backgroundRef]);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}