import { useEffect, useRef, type MutableRefObject } from 'react';
import { repAt, HIT_CENTS, type MelodyFrame, type NoteStatus, type TargetNote, type Timeline } from '../../utils/lipTrillExercise';

interface MelodyPlotProps {
  timeline: Timeline | null;
  /** Zaśpiewane ramki – czytane z refa w każdej klatce animacji. */
  framesRef: MutableRefObject<MelodyFrame[]>;
  clockRef: MutableRefObject<() => number>;
  /** Tryb przeglądania wyników */
  viewRep: number | null;
  /** Wynik oceny nut po wyrównaniu */
  statuses?: { status: NoteStatus; t0: number; t1: number }[][];
  noteName: (midi: number) => string;
  hidePitch?: boolean;
}

type RGB = [number, number, number];
const C_GOOD: RGB = [52, 211, 153]; // emerald-400, jak w pozostałych wykresach
const C_MID: RGB = [250, 204, 21];
const C_BAD: RGB = [244, 63, 94];
const rgb = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function colorForCents(abs: number): RGB {
  const band = HIT_CENTS;
  if (abs <= band) return C_GOOD;
  if (abs <= 2 * band) return mix(C_GOOD, C_MID, (abs - band) / band);
  if (abs <= 3 * band) return mix(C_MID, C_BAD, (abs - 2 * band) / band);
  return C_BAD;
}
const MAX_DRAW_GAP_SEC = 0.12;
const WHITE_KEYS = new Set([0, 2, 4, 5, 7, 9, 11]);
const PAD = { left: 46, right: 14, top: 14, bottom: 14 };

export default function MelodyPlot({ timeline, framesRef, clockRef, viewRep, statuses, noteName, hidePitch = false }: MelodyPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ timeline, viewRep, noteName, statuses, hidePitch });
  propsRef.current = { timeline, viewRep, noteName, statuses, hidePitch };

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
      const { timeline: tl, viewRep: view, noteName: name, statuses: st, hidePitch: noPitch } = propsRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!tl) { raf = requestAnimationFrame(draw); return; }

      const review = view !== null;
      const now = review ? Infinity : clockRef.current();
      const frames = framesRef.current;

      // co pokazać
      let notes: TargetNote[];
      let cues: TargetNote[] = [];
      let repIndex = -1;
      let from: number, to: number;
      const demoPhase = !review && tl.demo.length > 0 && now < tl.demoT1 + tl.beatSec * 0.5;
      if (demoPhase) {
        notes = tl.demo;
        from = -0.15;
        to = tl.demoT1 + 0.25;
      } else {
        const rep = review ? tl.reps[view] : repAt(tl, now) ?? (now < (tl.reps[0]?.cue.t0 ?? 0) ? tl.reps[0] : tl.reps[tl.reps.length - 1]);
        if (!rep) { raf = requestAnimationFrame(draw); return; }
        notes = rep.notes;
        // harmonia: melodia grana przez pianino w czasie śpiewania
        cues = [...(rep.cueNotes ?? [rep.cue]), ...(rep.accomp ?? [])];
        repIndex = rep.index;
        from = rep.cue.t0 - 0.15;
        to = rep.singT1 + 0.35;
        const res = review ? st?.[rep.index] : undefined;
        if (res) for (const r of res) if (Number.isFinite(r.t1)) to = Math.max(to, r.t1 + 0.35);
      }

      const x0 = PAD.left, x1 = width - PAD.right, y0 = PAD.top, y1 = height - PAD.bottom;
      const lo = tl.minMidi - 2, hi = tl.maxMidi + 2;
      const xOf = (t: number) => x0 + ((t - from) / (to - from)) * (x1 - x0);
      const yOf = (m: number) => y0 + ((hi - Math.max(lo - 1, Math.min(hi + 1, m))) / (hi - lo)) * (y1 - y0);
      const semiPx = (y1 - y0) / (hi - lo);

      // siatka półtonów i nazwy dźwięków
      ctx.font = '11px Cardo, Georgia, serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let m = Math.ceil(lo); m <= hi; m++) {
        const white = WHITE_KEYS.has(((m % 12) + 12) % 12);
        const y = yOf(m);
        ctx.strokeStyle = white ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.04)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        if (white || semiPx >= 16) {
          ctx.fillStyle = 'rgba(255,255,255,.5)';
          ctx.fillText(name(m), x0 - 8, y);
        }
      }

      // prostokąty nut
      const barH = Math.max(6, semiPx * 0.8);
      const drawBar = (n: TargetNote, fill: string, stroke: string, dashed = false) => {
        const xa = xOf(n.t0), xb = xOf(n.t1);
        const ya = yOf(n.midiFrom), yb = yOf(n.midiTo);
        const r = Math.min(6, barH / 2);
        ctx.beginPath();
        if (n.midiFrom === n.midiTo) {
          ctx.roundRect(xa, ya - barH / 2, Math.max(2, xb - xa), barH, r);
        } else {
          ctx.moveTo(xa, ya - barH / 2); ctx.lineTo(xb, yb - barH / 2);
          ctx.lineTo(xb, yb + barH / 2); ctx.lineTo(xa, ya + barH / 2); ctx.closePath();
        }
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.setLineDash(dashed ? [4, 4] : []);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
      };

      for (const cue of cues) {
        const playing = now >= cue.t0 && now <= cue.t1;
        drawBar(cue, `rgba(255,255,255,${playing ? 0.22 : 0.06})`, 'rgba(255,255,255,.55)', true);
      }
      for (const n of notes) {
        if (demoPhase) {
          const playing = now >= n.t0 && now <= n.t1;
          drawBar(n, `rgba(255,255,255,${playing ? 0.4 : now > n.t1 ? 0.2 : 0.12})`, `rgba(255,255,255,${playing ? 0.9 : 0.45})`);
          continue;
        }
        const res = review ? st?.[repIndex]?.[notes.indexOf(n)] : undefined;
        const status = res?.status;
        const placed: TargetNote = res && Number.isFinite(res.t0) && res.t1 > res.t0 ? { ...n, t0: res.t0, t1: res.t1 } : n;
        if (status === 'hit') drawBar(placed, rgb(C_GOOD, 0.3), rgb(C_GOOD, 0.85));
        else if (status === 'off') drawBar(placed, rgb(C_BAD, 0.22), rgb(C_BAD, 0.8));
        else if (status === 'silent') drawBar(n, 'rgba(255,255,255,.05)', 'rgba(255,255,255,.35)', true);
        else {
          // w trakcie śpiewania nie oceniamy nut po czasie
          const active = now >= n.t0 && now <= n.t1;
          drawBar(n, `rgba(255,255,255,${active ? 0.3 : now > n.t1 ? 0.1 : 0.14})`, `rgba(255,255,255,${active ? 0.85 : 0.5})`);
        }
      }

      // zaśpiewana linia (kolor zależny od odległości od nuty)
      if (!demoPhase && !noPitch) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const passes: [number, number][] = [[9, 0.05], [5.5, 0.12], [2.6, 1]];
        let i0 = 0;
        while (i0 < frames.length && (frames[i0]?.t ?? Infinity) < from) i0++;
        for (const [w, alpha] of passes) {
          ctx.globalAlpha = alpha;
          ctx.lineWidth = w;
          // łączymy kolejne ramki z dźwiękiem
          let a: MelodyFrame | null = null;
          for (let i = i0; i < frames.length; i++) {
            const b = frames[i];
            if (!b || b.t > to || b.t > now) break;
            if (!Number.isFinite(b.midi)) continue;
            if (a && b.t - a.t <= MAX_DRAW_GAP_SEC) {
              ctx.strokeStyle = Number.isFinite(b.cents) ? rgb(colorForCents(Math.abs(b.cents))) : 'rgba(255,255,255,.8)';
              ctx.beginPath(); ctx.moveTo(xOf(a.t), yOf(a.midi)); ctx.lineTo(xOf(b.t), yOf(b.midi)); ctx.stroke();
            }
            a = b;
          }
        }
        ctx.globalAlpha = 1;
      }

      // kursor
      if (!review && now >= from && now <= to) {
        const x = xOf(now);
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        const last = frames[frames.length - 1];
        if (!demoPhase && !noPitch && last && now - last.t < 0.15 && Number.isFinite(last.midi)) {
          ctx.save();
          ctx.shadowColor = Number.isFinite(last.cents) ? rgb(colorForCents(Math.abs(last.cents))) : '#fff';
          ctx.shadowBlur = 18;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(x, yOf(last.midi), 5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [framesRef, clockRef]);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
