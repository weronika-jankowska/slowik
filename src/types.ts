export type AdvancementLevel = 'Amatorski' | 'Średniozaawansowany' | 'Zaawansowany';
export type SingingStyle = 'Amatorski' | 'Chóralny' | 'Rozrywkowy';

export interface VibratoMetrics {
  present: boolean;
  rateHz: number;
  extentPercent: number;
  onsetDelaySec: number;
  sinusoidality: number; // VIB_S (Żwan, Kostek 2008)
}

export interface MPFRData {
  mpfrSemitones: number;
  f010Semitones: number;
  f090Semitones: number;
  f090_10Semitones: number;
  spl10Db: number;
  spl90Db: number;
  spl90_10Db: number;
}

export interface VoiceMetrics {
  pitchMinHz: number;
  pitchMaxHz: number;
  vocalRangeNotes: { low: string; high: string };
  intonationErrorCents: number;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  spectralNoiseDb: number;
  singerFormantEnergyDb: number;
  spr: number;
  vibrato: VibratoMetrics;
  mpfr?: MPFRData;
}

export interface UserVoiceProfile {
  level: AdvancementLevel;
  primaryStyle: SingingStyle;
  metrics: VoiceMetrics;
}