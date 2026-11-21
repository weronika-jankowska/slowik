// Przedłużanie próbki pianina („sustain”) do dowolnej długości

/** Początek fragmentu pętli [s] – po ataku młoteczka. */
const LOOP_START_SEC = 0.6;
const LOOP_LEN_SEC = 0.6;
/** Okno pomiaru głośności przy wyrównywaniu wygasania [s]. */
const ENV_WIN_SEC = 0.05;
/** Długość przenikania na szwie pętli [s]. */
const XFADE_SEC = 0.03;

export interface SustainedSample {
  buffer: AudioBuffer;
  loopStart: number;
  loopEnd: number;
}

/** Przygotowuje próbkę z pętlą. `f0` */
export function makeSustained(ctx: BaseAudioContext, src: AudioBuffer, f0: number): SustainedSample | null {
  const sr = src.sampleRate;
  const period = sr / f0;
  const start = Math.round(LOOP_START_SEC * sr);
  const len = Math.round(Math.max(1, Math.round((LOOP_LEN_SEC * sr) / period)) * period);
  const xf = Math.min(Math.round(XFADE_SEC * sr), Math.floor(len / 4));
  if (start + len + 1 > src.length || start < xf) return null;

  const out = ctx.createBuffer(src.numberOfChannels, start + len, sr);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const x = src.getChannelData(ch);
    const y = out.getChannelData(ch);
    const win = Math.max(1, Math.round(ENV_WIN_SEC * sr));
    const ts: number[] = [], ls: number[] = [];
    for (let a = start; a + win <= start + len; a += win) {
      let e = 0;
      for (let i = a; i < a + win; i++) e += (x[i] ?? 0) ** 2;
      ts.push((a + win / 2 - start) / sr);
      ls.push(10 * Math.log10(e / win + 1e-12));
    }
    let slope = 0;
    if (ts.length >= 2) {
      const mt = ts.reduce((p, v) => p + v, 0) / ts.length, ml = ls.reduce((p, v) => p + v, 0) / ls.length;
      let num = 0, den = 0;
      for (let k = 0; k < ts.length; k++) { num += ((ts[k] as number) - mt) * ((ls[k] as number) - ml); den += ((ts[k] as number) - mt) ** 2; }
      slope = den > 0 ? Math.min(0, num / den) : 0; // tylko wygasanie (dB/s ≤ 0)
    }
    // korekta: 1 na początku pętli, potem odwrotność wygasania
    const corr = (i: number) => (i < start ? 1 : 10 ** ((-slope * ((i - start) / sr)) / 20));
    for (let i = 0; i < start + len; i++) y[i] = (x[i] ?? 0) * corr(i);
    for (let i = 0; i < xf; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / xf);
      const k = start + len - xf + i;
      y[k] = (1 - w) * (y[k] as number) + w * (x[start - xf + i] ?? 0);
    }
  }
  return { buffer: out, loopStart: start / sr, loopEnd: (start + len) / sr };
}
