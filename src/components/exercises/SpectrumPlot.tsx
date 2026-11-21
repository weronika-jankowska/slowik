import { useEffect, useRef, type MutableRefObject } from 'react';

export interface SpectrumData {
  /** Widmo główne (uśrednione) w dB – gruba, świecąca linia. */
  main: Float32Array | null;
  /** Widmo chwilowe w dB – cienka linia w tle (opcjonalnie). */
  instant: Float32Array | null;
  /** Szerokość binu [Hz]. */
  binHz: number;
}

interface SpectrumPlotProps {
  dataRef: MutableRefObject<SpectrumData>;
  /** Zielone pole */
  bandLoHz: number;
  bandHiHz: number;
  goodDb: number;
  minDb: number;
  maxHz?: number;
  rangeDb?: number;
  /** Czy trwa nagrywanie (podświetlenie pola przy dobrym wyniku). */
  running: boolean;
}

const GREEN = '52, 211, 153'; // emerald-400, jak w PitchPlot
type RGB = [number, number, number];
const C_GOOD: RGB = [52, 211, 153];
const C_MID: RGB = [250, 204, 21];
const C_BAD: RGB = [244, 63, 94];
const rgbStr = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const PAD = { left: 46, right: 14, top: 14, bottom: 26 };

function maxInRange(db: Float32Array, binHz: number, lo: number, hi: number): { i: number; v: number } {
  let best = { i: -1, v: -Infinity };
  const a = Math.max(1, Math.ceil(lo / binHz));
  const b = Math.min(db.length - 1, Math.floor(hi / binHz));
  for (let i = a; i <= b; i++) {
    const v = db[i] ?? -Infinity;
    if (v > best.v) best = { i, v };
  }
  return best;
}

export default function SpectrumPlot({ dataRef, bandLoHz, bandHiHz, goodDb, minDb, maxHz = 5000, rangeDb = 70, running }: SpectrumPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ bandLoHz, bandHiHz, goodDb, minDb, maxHz, rangeDb, running });
  propsRef.current = { bandLoHz, bandHiHz, goodDb, minDb, maxHz, rangeDb, running };

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
      const { bandLoHz: bLo, bandHiHz: bHi, goodDb: good, minDb: bad, maxHz: fMax, rangeDb: range, running: isRunning } = propsRef.current;
      const { main, instant, binHz } = dataRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const x0 = PAD.left;
      const x1 = width - PAD.right;
      const y0 = PAD.top;
      const y1 = height - PAD.bottom;
      const xOf = (f: number) => x0 + (Math.min(Math.max(f, 0), fMax) / fMax) * (x1 - x0);

      // poziom odniesienia: najwyższy punkt widma głównego = 0 dB
      const ref = main ?? instant;
      const top = ref && binHz > 0 ? maxInRange(ref, binHz, 50, fMax).v : NaN;
      const refDb = Number.isFinite(top) ? top : 0;
      const yOf = (db: number) => {
        const rel = Math.max(-range * 1.02, Math.min(0, db - refDb));
        return y0 + (-rel / range) * (y1 - y0);
      };

      let spr = NaN;
      let low = { i: -1, v: -Infinity };
      let high = { i: -1, v: -Infinity };
      if (main && binHz > 0) {
        low = maxInRange(main, binHz, 50, 2000);
        high = maxInRange(main, binHz, bLo, bHi);
        if (low.i > 0 && high.i > 0) spr = high.v - low.v;
      }
      const level: RGB = !Number.isFinite(spr) ? C_BAD : spr >= good ? C_GOOD : spr > bad ? C_MID : C_BAD;
      const glow = isRunning && Number.isFinite(spr) && spr >= good;

      // siatka i opisy osi
      ctx.font = '11px Cardo, Georgia, serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let d = 0; d <= range + 1e-6; d += 10) {
        const y = y0 + (d / range) * (y1 - y0);
        ctx.strokeStyle = d === 0 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillText(d === 0 ? '0' : `−${d}`, x0 - 8, y);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let f = 0; f <= fMax + 1e-6; f += 1000) {
        const x = xOf(f);
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.textAlign = f + 1000 > fMax ? 'right' : 'center'; // ostatni opis nie wychodzi poza wykres
        ctx.fillText(f === 0 ? '0' : `${f / 1000} kHz`, f + 1000 > fMax ? x1 : x, y1 + 6);
      }
      ctx.save();
      ctx.translate(12, (y0 + y1) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText('poziom względem szczytu [dB]', 0, 0);
      ctx.restore();

      // zielone pole (bez napisów na nim)
      const bx0 = xOf(bLo);
      const bx1 = xOf(bHi);
      ctx.save();
      if (glow) { ctx.shadowColor = `rgba(${GREEN}, .85)`; ctx.shadowBlur = 22; }
      ctx.fillStyle = `rgba(${GREEN}, ${glow ? 0.3 : 0.15})`;
      ctx.fillRect(bx0, y0, bx1 - bx0, y1 - y0);
      ctx.restore();
      ctx.strokeStyle = `rgba(${GREEN}, ${glow ? 0.95 : 0.5})`;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx0 + 0.5, y0 + 0.5, bx1 - bx0 - 1, y1 - y0 - 1);

      const lastBin = binHz > 0 ? Math.min((ref?.length ?? 0) - 1, Math.floor(fMax / binHz)) : -1;
      const tracePath = (db: Float32Array, fromBin: number, toBin: number) => {
        ctx.beginPath();
        for (let i = fromBin; i <= toBin; i++) {
          const x = xOf(i * binHz);
          const y = yOf(db[i] ?? -200);
          if (i === fromBin) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      };

      // widmo chwilowe – cienka linia
      if (instant && binHz > 0 && lastBin > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        tracePath(instant, 1, lastBin);
        ctx.stroke();
      }

      // widmo uśrednione
      if (main && binHz > 0 && lastBin > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const passes: [number, number][] = [[9, 0.05], [5.5, 0.12], [2.6, 1]];
        const bandFrom = Math.max(1, Math.floor(bLo / binHz));
        const bandTo = Math.min(lastBin, Math.ceil(bHi / binHz));
        for (const [w, alpha] of passes) {
          ctx.globalAlpha = alpha;
          ctx.lineWidth = w;
          ctx.strokeStyle = 'rgba(225, 232, 255, 1)';
          tracePath(main, 1, lastBin);
          ctx.stroke();
          ctx.strokeStyle = rgbStr(level);
          tracePath(main, bandFrom, bandTo);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        if (low.i > 0 && high.i > 0) {
          const lx = xOf(low.i * binHz), ly = yOf(low.v);
          const hx = xOf(high.i * binHz), hy = yOf(high.v);
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(255,255,255,.4)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(hx, ly); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = rgbStr(level, 0.9);
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(hx, ly); ctx.lineTo(hx, hy); ctx.stroke();

          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
          ctx.save();
          ctx.shadowColor = rgbStr(level);
          ctx.shadowBlur = 16;
          ctx.fillStyle = rgbStr(level);
          ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

          // wartość SPR po prawej stronie pola (nie na polu)
          if (bx1 + 70 < x1 + 1) {
            ctx.font = '12px Cardo, Georgia, serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = rgbStr(level);
            ctx.fillText(`SPR ${spr.toFixed(1).replace('.', ',').replace('-', '−')} dB`, bx1 + 8, (ly + hy) / 2);
          }
        }
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