// Ćwiczenie „Formant śpiewaczy”

/** Wartości referencyjne SPR dla śpiewanego /a/ (Omori i in.). */
export const SPR_REF = {
  nonsingers: -22.7,
  amateurs: -14.2,
  professionals: -13.1
} as const;

export const SPR_BAND_HZ = { lo: 2000, hi: 4000 } as const;
/** Typowy obszar samego formantu śpiewaczego. */
export const SINGER_FORMANT_HZ = { lo: 2500, hi: 3500 } as const;

export type SprLevel = 'good' | 'ok' | 'work';

/** Progi = średnie grupowe z literatury */
export function sprLevel(spr: number): SprLevel {
  if (spr >= SPR_REF.amateurs) return 'good';
  if (spr > SPR_REF.nonsingers) return 'ok';
  return 'work';
}

export interface FormantAttemptResult {
  sufficient: boolean;
  /** SPR z widma długoterminowego (LTAS) całego nagrania. */
  sprDb: number;
  /** Najwyższe SPR z jednosekundowych fragmentów. */
  bestSprDb: number;
  /** Częstotliwość najwyższego szczytu w paśmie 2–4 kHz. */
  peakHz: number;
  /** Udział energii pasma 2,5–3,5 kHz w całym widmie [dB]. */
  sfEnergyDb: number;
}

export interface FormantFeedbackRow { id: string; label: string; value: string; comment: string }

export interface FormantFeedback {
  tone: SprLevel | 'insufficient';
  headline: string;
  detail: string;
  rows: FormantFeedbackRow[];
}

export function formantFeedback(r: FormantAttemptResult): FormantFeedback {
  if (!r.sufficient || !Number.isFinite(r.sprDb)) {
    return {
      tone: 'insufficient',
      headline: 'Za mało nagranego dźwięku',
      detail: 'Zaśpiewaj ponownie i trzymaj dźwięk przez cały czas nagrania.',
      rows: []
    };
  }

  // wynik tylko słownie (poziom wzmocnienia w paśmie 2–4 kHz)
  const tone = sprLevel(r.sprDb);
  const headline =
    tone === 'good' ? 'Wyraźne wzmocnienie w paśmie 2–4 kHz'
    : tone === 'ok' ? 'Słabe wzmocnienie w paśmie 2–4 kHz'
    : 'Brak wzmocnienia w paśmie 2–4 kHz';
  const detail =
    tone === 'good' ? 'Twój głos ma wyraźną energię w paśmie, które pomaga mu przebić się przez akompaniament.'
    : tone === 'ok' ? 'W tym paśmie widać wzmocnienie, ale jest jeszcze słabe.'
    : 'W tym paśmie nie widać wyraźnego wzmocnienia.';

  return {
    tone,
    headline,
    detail,
    rows: []
  };
}