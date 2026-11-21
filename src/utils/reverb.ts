
/** Czas pogłosu RT60 [s] */
const RT60_SEC = 3.5;
/** Długość odpowiedzi impulsowej [s]. */
const IR_SEC = 4.5;
/** Opóźnienie pierwszych odbić [s]. */
const PREDELAY_SEC = 0.02;

export function makeImpulseResponse(ctx: BaseAudioContext, rnd: () => number = Math.random): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(IR_SEC * sr);
  const pre = Math.round(PREDELAY_SEC * sr);
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let y = 0, energy = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      // filtr dolnoprzepustowy coraz silniejszy z czasem
      const a = Math.min(0.92, 0.25 + 0.2 * t);
      y = a * y + (1 - a) * (rnd() * 2 - 1);
      const v = y * Math.pow(10, (-3 * t) / RT60_SEC); // −60 dB po RT60
      d[i] = v;
      energy += v * v;
    }
    const k = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    for (let i = 0; i < len; i++) d[i] = (d[i] as number) * k;
  }
  return ir;
}
