// Ćwiczenie „Ziewnięcie z westchnieniem”

export interface GlideData {
  /** Czas od początku dźwięku [s]. */
  t: number[];
  midi: number[];
}

export interface MpfrRange { lowMidi: number; highMidi: number }

export interface GlideResult {
  sufficient: boolean;
  peakMidi: number;
  peakTimeSec: number;
  lowMidi: number;
  spanSemitones: number;
  jumps: number;
  /** Czy przebieg był rzeczywiście „z góry w dół”. */
  descending: boolean;
}

const JUMP_SEMITONES = 1.5;
/** Skoki bliżej siebie niż tyle sekund liczymy jako jeden. */
const JUMP_MERGE_SEC = 0.15;

function median(v: number[]): number {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Odrzuca błędy oktawowe detektora */
export function filterOctaveErrors(prevValid: number[], midi: number): number {
  if (!Number.isFinite(midi) || prevValid.length < 3) return midi;
  const ref = median(prevValid.slice(-5));
  return Math.abs(midi - ref) > 9 ? NaN : midi;
}

export function analyzeGlide(d: GlideData, minVoicedFrames = 15): GlideResult {
  // mediana z 5 ramek
  const sm = d.midi.map((_, i) => {
    if (!Number.isFinite(d.midi[i] ?? NaN)) return NaN;
    return median(d.midi.slice(Math.max(0, i - 2), i + 3));
  });

  let peak = -Infinity, peakT = 0, low = Infinity, voiced = 0, lastValid = NaN;
  for (let i = 0; i < sm.length; i++) {
    const m = sm[i] ?? NaN;
    if (!Number.isFinite(m)) continue;
    voiced++;
    lastValid = m;
    if (m > peak) { peak = m; peakT = d.t[i] ?? 0; }
    if (m < low) low = m;
  }

  let jumps = 0, lastJumpT = -Infinity;
  for (let i = 1; i < d.midi.length; i++) {
    const a = d.midi[i - 1] ?? NaN, b = d.midi[i] ?? NaN;
    const ta = d.t[i - 1] ?? 0, tb = d.t[i] ?? 0;
    if (!Number.isFinite(a) || !Number.isFinite(b) || tb - ta > 0.06) continue;
    if (Math.abs(b - a) > JUMP_SEMITONES) {
      if (tb - lastJumpT > JUMP_MERGE_SEC) jumps++;
      lastJumpT = tb;
    }
  }

  const endT = d.t[d.t.length - 1] ?? 0;
  const sufficient = voiced >= minVoicedFrames && Number.isFinite(peak);
  return {
    sufficient,
    peakMidi: sufficient ? peak : NaN,
    peakTimeSec: peakT,
    lowMidi: sufficient ? low : NaN,
    spanSemitones: sufficient ? peak - low : NaN,
    jumps,
    descending: sufficient && peakT <= endT * 0.5 && peak - lastValid >= 3
  };
}

// ---------- Komunikaty ----------

export interface GlideFeedbackRow { id: string; label: string; value: string; comment: string }
export interface GlideFeedback {
  tone: 'good' | 'ok' | 'insufficient';
  headline: string;
  detail: string;
  rows: GlideFeedbackRow[];
}

const fmt = (x: number, digits = 1) =>
  x.toLocaleString('pl-PL', { maximumFractionDigits: digits, minimumFractionDigits: digits });

function semitonesWord(n: number): string {
  if (n === 1) return 'półton';
  const last = n % 10, lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'półtony' : 'półtonów';
}

export function glideFeedback(
  r: GlideResult,
  noteName: (midi: number) => string,
  midiToHz: (midi: number) => number,
  mpfr: MpfrRange | null,
  sessionBestMidi: number
): GlideFeedback {
  if (!r.sufficient) {
    return {
      tone: 'insufficient',
      headline: 'Za mało nagranego dźwięku',
      detail: 'Spróbuj jeszcze raz: zacznij od ziewnięcia i pozwól dźwiękowi swobodnie opaść w dół.',
      rows: []
    };
  }

  const peakRounded = Math.round(r.peakMidi);
  const headline = `Najwyższy dźwięk westchnienia: ${noteName(peakRounded)}`;

  let detail: string;
  let tone: GlideFeedback['tone'] = 'ok';
  if (mpfr) {
    const above = Math.round(r.peakMidi - mpfr.highMidi);
    if (above > 0) {
      tone = 'good';
      detail = `To ${above} ${semitonesWord(above)} powyżej najwyższego dźwięku z Twojej analizy głosu. Rozluźniony głos sięga wyżej, niż się wydaje.`;
    } else if (above === 0) {
      tone = 'good';
      detail = 'To tyle samo, co najwyższy dźwięk z Twojej analizy głosu. Przy następnym ziewnięciu spróbuj zacząć jeszcze odrobinę wyżej.';
    } else {
      detail = 'Ten dźwięk mieści się w zakresie z Twojej analizy głosu. Przy następnym ziewnięciu otwórz szerzej usta i pozwól głosowi zacząć wyżej, bez wysiłku.';
    }
  } else {
    tone = r.spanSemitones >= 12 ? 'good' : 'ok';
    detail = 'Wykonaj analizę głosu, aby porównać ten wynik ze swoim zakresem.';
  }
  if (!r.descending) detail += ' Pamiętaj, by zacząć wysoko i zjechać w dół, jak przy westchnieniu.';

  const span = Math.round(r.spanSemitones);
  const sessionNote =
    Number.isFinite(sessionBestMidi) && Math.round(sessionBestMidi) > peakRounded
      ? `Najwyżej w tej sesji: ${noteName(Math.round(sessionBestMidi))}`
      : 'Najwyższy dźwięk w tej próbie';

  return {
    tone,
    headline,
    detail,
    rows: [
      { id: 'peak', label: 'najwyższy dźwięk', value: `${noteName(peakRounded)} (${fmt(midiToHz(r.peakMidi), 0)} Hz)`, comment: sessionNote },
      { id: 'low', label: 'najniższy dźwięk', value: `${noteName(Math.round(r.lowMidi))} (${fmt(midiToHz(r.lowMidi), 0)} Hz)`, comment: 'Dźwięk, na którym skończyło się westchnienie' },
      {
        id: 'span',
        label: 'rozpiętość',
        value: `${span} ${semitonesWord(span)}`,
        comment: span >= 12 ? `To ${fmt(span / 12, 1)} oktawy` : 'Mniej niż oktawa – spróbuj zwiększyć zakres dźwięków'
      },
      {
        id: 'smooth',
        label: 'płynność',
        value: r.jumps === 0 ? 'bez skoków' : `${r.jumps} ${r.jumps === 1 ? 'skok' : r.jumps < 5 ? 'skoki' : 'skoków'}`,
        comment: r.jumps === 0
          ? 'Głos przeszedł w dół płynnie'
          : 'Przy zmianie rejestru często pojawia się skok wysokości. Postaraj się, żeby ich nie było.'
      }
    ]
  };
}