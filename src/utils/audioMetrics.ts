export interface VibratoAnalysisResult {
  rateHz: number;
  extentCents: number;
  extentSemitones: number;
  onsetDelaySec: number;
  sinusoidality: number; // VIBS
  periodicity: number; // VIBP
  harmonicity: number; // VIBH
  hasVibrato: boolean;
}

export interface AcousticMetricsState {
  f0: number;
  rms: number;
  rmsDbfs: number;
  maeCents: number;
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  spectralNoiseDb: number;
  spectralCentroidHz: number;
  singerFormantEnergyDb: number;
  spr: number;
  sppFreqHz: number;
  vibrato: VibratoAnalysisResult;
}

export interface MPFRResult {
  f0MinHz: number;
  f0MaxHz: number;
  f0MinMidi: number;
  f0MaxMidi: number;
  f0MinNoteName: string;
  f0MaxNoteName: string;
  mpfrSemitones: number;
  mpfrOctaves: number;
}

export type AdvancementLevel = 'Amatorski' | 'Średniozaawansowany' | 'Zaawansowany';
export type SingingStyle = 'Amatorski' | 'Chóralny' | 'Rozrywkowy';

export interface VocalStyleClassification {
  primaryStyle: 'Amatorski' | 'Chóralny' | 'Rozrywkowy';
  description: string;
  spectralCentroidHz: number;
  presenceBandPercent: number;
  recommendation: string;
}

// Obliczenie wartości skutecznej (RMS)
export function calculateRMS(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const val = buffer[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum / buffer.length);
}

// Algorytm YIN z interpolacją paraboliczną (de Cheveigné & Kawahara, 2002)
export function pitchYIN(buffer: Float32Array, sampleRate: number, threshold = 0.15): number {
  const bufferSize = Math.floor(buffer.length / 2);
  const yinBuffer = new Float32Array(bufferSize);

  // Krok 2: Funkcja różnicowa d(t)
  for (let t = 0; t < bufferSize; t++) {
    let sum = 0;
    for (let i = 0; i < bufferSize; i++) {
      const delta = (buffer[i] ?? 0) - (buffer[i + t] ?? 0);
      sum += delta * delta;
    }
    yinBuffer[t] = sum;
  }

  // Krok 3: Skumulowana średnia znormalizowana d'(t)
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let t = 1; t < bufferSize; t++) {
    runningSum += yinBuffer[t] ?? 0;
    yinBuffer[t] = runningSum === 0 ? 1 : ((yinBuffer[t] ?? 0) * t) / runningSum;
  }

  // Krok 4: Próg bezwzględny z wyszukiwaniem minimum
  let tau = -1;
  for (let t = 2; t < bufferSize; t++) {
    if ((yinBuffer[t] ?? 1) < threshold) {
      while (t + 1 < bufferSize && (yinBuffer[t + 1] ?? 1) < (yinBuffer[t] ?? 1)) {
        t++;
      }
      tau = t;
      break;
    }
  }

  // Fallback: Jeśli brak wartości poniżej progu, znajdź minimum globalne
  if (tau === -1) {
    let globalMin = Infinity;
    for (let t = 2; t < bufferSize; t++) {
      const val = yinBuffer[t] ?? 1;
      if (val < globalMin) {
        globalMin = val;
        tau = t;
      }
    }
    if (globalMin > 0.8 || tau <= 0) return -1;
  }

  // Krok 5: Poprawna interpolacja paraboliczna
  let betterTau = tau;
  if (tau > 0 && tau < bufferSize - 1) {
    const s0 = yinBuffer[tau - 1] ?? 0;
    const s1 = yinBuffer[tau] ?? 0;
    const s2 = yinBuffer[tau + 1] ?? 0;

    const denom = 2 * (s0 - 2 * s1 + s2);
    if (Math.abs(denom) > 1e-12) {
      betterTau = tau + (s0 - s2) / denom;
    }
  }

  return sampleRate / betterTau;
}

/**
 * Ścisła walidacja samogłoski [A] eliminująca mormorando [M], inne głoski ([U], [I]) oraz pisk krtaniowy
 */
export function validateVocalEmission(analyser: AnalyserNode, f0: number): boolean {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  const sampleRate = analyser.context.sampleRate;
  const binSize = (sampleRate / 2) / analyser.frequencyBinCount;

  let totalEnergy = 0;
  let vowelAFormantEnergy = 0; // Pasmo F1-F2 dla [A]: 600 - 1450 Hz
  let whistleNoiseEnergy = 0;   // Pasmo pisku: > 4500 Hz

  for (let i = 0; i < freqData.length; i++) {
    const freq = i * binSize;
    const energy = Math.pow(10, (freqData[i] ?? -100) / 20);
    totalEnergy += energy;

    if (freq >= 600 && freq <= 1450) {
      vowelAFormantEnergy += energy;
    } else if (freq >= 4500) {
      whistleNoiseEnergy += energy;
    }
  }

  if (totalEnergy === 0) return false;

  // 1. Eliminacja pisku naddźwiękowego
  if ((whistleNoiseEnergy / totalEnergy) > 0.35) {
    return false;
  }

  const f0Bin = Math.round(f0 / binSize);
  const f0Magnitude = freqData[f0Bin] ?? -100;

  // 2. Dla dźwięków do 450 Hz: otwarta samogłoska [A] musi posiadać energię w paśmie 600 - 1450 Hz
  if (f0 < 450) {
    const vowelRatio = vowelAFormantEnergy / totalEnergy;
    return vowelRatio >= 0.13 && f0Magnitude > -55;
  }

  // 3. Dla wysokich dźwięków (f0 >= 450 Hz): badamy odstęp sygnału F0 od szumu tła
  const noiseBin = Math.min(freqData.length - 1, Math.round(5500 / binSize));
  const noiseMagnitude = freqData[noiseBin] ?? -100;

  return (f0Magnitude - noiseMagnitude) > 12 && f0Magnitude > -55;
}

// Wyliczenie amplitud i długości okresów do obliczenia Jitter i Shimmer
export function extractGlottalCycles(
  buffer: Float32Array,
  sampleRate: number,
  f0Est: number
): { periods: number[]; peakAmplitudes: number[] } {
  if (f0Est <= 0) return { periods: [], peakAmplitudes: [] };

  const nominalPeriod = Math.round(sampleRate / f0Est);
  const minPeriod = Math.floor(nominalPeriod * 0.7);
  const maxPeriod = Math.ceil(nominalPeriod * 1.3);

  const peakIndices: number[] = [];
  let idx = 0;
  let foundInitialPeak = false;

  for (let i = 1; i < Math.min(buffer.length - 1, nominalPeriod * 2); i++) {
    if ((buffer[i] ?? 0) > (buffer[i - 1] ?? 0) && (buffer[i] ?? 0) > (buffer[i + 1] ?? 0) && (buffer[i] ?? 0) > 0.01) {
      peakIndices.push(i);
      idx = i;
      foundInitialPeak = true;
      break;
    }
  }

  if (!foundInitialPeak) {
    idx = 0;
  }

  while (idx + minPeriod < buffer.length) {
    const searchStart = idx + minPeriod;
    const searchEnd = Math.min(buffer.length - 1, idx + maxPeriod);

    let maxVal = -Infinity;
    let bestIdx = -1;

    for (let j = searchStart; j <= searchEnd; j++) {
      const curr = buffer[j] ?? 0;
      if (curr > maxVal && curr > (buffer[j - 1] ?? 0) && curr > (buffer[j + 1] ?? 0)) {
        maxVal = curr;
        bestIdx = j;
      }
    }

    if (bestIdx !== -1 && maxVal > 0.005) {
      peakIndices.push(bestIdx);
      idx = bestIdx;
    } else {
      idx += nominalPeriod;
    }
  }

  const periods: number[] = [];
  const peakAmplitudes: number[] = [];

  for (let i = 0; i < peakIndices.length; i++) {
    peakAmplitudes.push(Math.abs(buffer[peakIndices[i]!] ?? 0));
    if (i > 0) {
      periods.push((peakIndices[i]! - peakIndices[i - 1]!) / sampleRate);
    }
  }

  return { periods, peakAmplitudes };
}

/**
 * Obliczenie Harmonicity (HNR w dB) metodą autokorelacji (AC) dokładnie wg algorytmu programu Praat
 */
export function calculateHNR(buffer: Float32Array, sampleRate: number, f0: number): number {
  if (f0 <= 0 || buffer.length < 4) return -200.0;

  const N = buffer.length;
  const targetLag = sampleRate / f0;

  const minLag = Math.max(1, Math.floor(targetLag * 0.75));
  const maxLag = Math.min(Math.floor(N / 2), Math.ceil(targetLag * 1.25));

  if (minLag >= maxLag || maxLag >= N) return -200.0;

  const windowed = new Float32Array(N);
  let totalEnergy = 0;
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    const val = (buffer[i] ?? 0) * w;
    windowed[i] = val;
    totalEnergy += val * val;
  }

  if (totalEnergy <= 1e-15) return -200.0;

  let bestLag = minLag;
  let maxR = -Infinity;
  const rValues = new Float32Array(maxLag - minLag + 3);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;

    for (let i = 0; i < N - lag; i++) {
      const x = windowed[i] ?? 0;
      const y = windowed[i + lag] ?? 0;
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    }

    const denom = Math.sqrt(sumXX * sumYY);
    const rNorm = denom > 1e-15 ? sumXY / denom : 0;

    const rIdx = lag - minLag + 1;
    rValues[rIdx] = rNorm;

    if (rNorm > maxR) {
      maxR = rNorm;
      bestLag = lag;
    }
  }

  let r = maxR;
  const peakIdx = bestLag - minLag + 1;
  if (peakIdx > 1 && peakIdx < rValues.length - 2) {
    const y1 = rValues[peakIdx - 1] ?? maxR;
    const y2 = rValues[peakIdx] ?? maxR;
    const y3 = rValues[peakIdx + 1] ?? maxR;

    const denomInterp = 2 * (2 * y2 - y1 - y3);
    if (denomInterp > 1e-12) {
      const delta = (y3 - y1) / denomInterp;
      r = y2 + 0.5 * delta * (y3 - y1);
    }
  }

  if (r <= 1e-15) return -150.0;
  if (r >= 1.0 - 1e-15) return 150.0;

  const hnr = 10.0 * Math.log10(r / (1.0 - r));

  return Math.round(hnr * 10) / 10;
}

// Obliczanie Jitter i Shimmer cykl-do-cyklu
export function calculateJitterShimmerCycleToCycle(
  periods: number[],
  amplitudes: number[]
): { jitterPercent: number; shimmerDb: number } {
  if (periods.length < 5 || amplitudes.length < 5) {
    return { jitterPercent: 0, shimmerDb: 0 };
  }

  let diffPeriodSum = 0;
  let periodSum = 0;
  for (let i = 1; i < periods.length; i++) {
    diffPeriodSum += Math.abs((periods[i] ?? 0) - (periods[i - 1] ?? 0));
    periodSum += periods[i] ?? 0;
  }
  periodSum += periods[0] ?? 0;
  const meanPeriod = periodSum / periods.length;
  const jitterPercent = meanPeriod > 0 ? (diffPeriodSum / (periods.length - 1) / meanPeriod) * 100 : 0;

  let shimmerSum = 0;
  let validPairs = 0;
  for (let i = 1; i < amplitudes.length; i++) {
    const a1 = amplitudes[i - 1] ?? 0;
    const a2 = amplitudes[i] ?? 0;
    if (a1 > 1e-4 && a2 > 1e-4) {
      shimmerSum += Math.abs(20 * Math.log10(a1 / a2));
      validPairs++;
    }
  }
  const shimmerDb = validPairs > 0 ? shimmerSum / validPairs : 0;

  return {
    jitterPercent: Math.round(jitterPercent * 100) / 100,
    shimmerDb: Math.round(shimmerDb * 100) / 100
  };
}

// Szum widmowy mierzony w dolinach międzyharmonicznych
export function calculateSpectralNoise(analyser: AnalyserNode, f0: number): number {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  const nyquist = analyser.context.sampleRate / 2;
  const binHz = nyquist / analyser.frequencyBinCount;

  let noiseSum = 0;
  let count = 0;
  const maxHarmonics = 8;
  const upperLimit = nyquist * 0.9;

  if (f0 > 0) {
    for (let h = 1; h <= maxHarmonics; h++) {
      const valleyFreq = f0 * (h + 0.5);
      if (valleyFreq >= upperLimit) break;
      const bin = Math.round(valleyFreq / binHz);
      if (bin < freqData.length) {
        noiseSum += freqData[bin] ?? -100;
        count++;
      }
    }
  }

  return count > 0 ? noiseSum / count : -45;
}

/**
 * Singing Power Ratio (SPR) oraz Singing Power Peak (SPP) wg Omori et al. (1996)
 */
export function calculateSingerFormantAndSPR(analyser: AnalyserNode): {
  sfEnergyDb: number;
  spr: number;
  sppFreqHz: number;
  spectralCentroidHz: number;
} {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  const binHz = (analyser.context.sampleRate / 2) / analyser.frequencyBinCount;

  let maxLowHarmonicDb = -Infinity;
  let maxHighHarmonicDb = -Infinity;
  let sppFreqHz = 0;

  let sfEnergyLinearSum = 0;
  let sfCount = 0;

  let totalLinEnergy = 0;
  let weightedFreqSum = 0;

  for (let i = 0; i < freqData.length; i++) {
    const f = i * binHz;
    const dbVal = freqData[i] ?? -120;
    const linPower = Math.pow(10, dbVal / 10);

    totalLinEnergy += linPower;
    weightedFreqSum += f * linPower;

    const prevDb = i > 0 ? (freqData[i - 1] ?? -120) : -120;
    const nextDb = i < freqData.length - 1 ? (freqData[i + 1] ?? -120) : -120;
    const isPeak = dbVal > prevDb && dbVal > nextDb;

    // Pasmo 0 - 2000 Hz: szukamy najwyższego szczytu harmonicznego
    if (f >= 50 && f <= 2000) {
      if (isPeak && dbVal > maxLowHarmonicDb) {
        maxLowHarmonicDb = dbVal;
      }
    }

    // Pasmo 2000 - 4000 Hz: szukamy szczytu Singing Power Peak (SPP)
    if (f >= 2000 && f <= 4000) {
      if (isPeak && dbVal > maxHighHarmonicDb) {
        maxHighHarmonicDb = dbVal;
        sppFreqHz = f;
      }
    }

    // Średnia energia w paśmie formantu śpiewaka (2500 - 3500 Hz)
    if (f >= 2500 && f <= 3500) {
      sfEnergyLinearSum += linPower;
      sfCount++;
    }
  }

  if (maxLowHarmonicDb === -Infinity) {
    for (let i = 0; i < freqData.length; i++) {
      const f = i * binHz;
      if (f <= 2000 && (freqData[i] ?? -120) > maxLowHarmonicDb) {
        maxLowHarmonicDb = freqData[i] ?? -120;
      }
    }
  }

  if (maxHighHarmonicDb === -Infinity) {
    for (let i = 0; i < freqData.length; i++) {
      const f = i * binHz;
      if (f >= 2000 && f <= 4000 && (freqData[i] ?? -120) > maxHighHarmonicDb) {
        maxHighHarmonicDb = freqData[i] ?? -120;
        sppFreqHz = f;
      }
    }
  }

  const spr = maxHighHarmonicDb - maxLowHarmonicDb;
  const sfEnergyDb = sfCount > 0 ? 10 * Math.log10(sfEnergyLinearSum / sfCount) : -100;
  const spectralCentroidHz = totalLinEnergy > 0 ? weightedFreqSum / totalLinEnergy : 1000;

  return {
    sfEnergyDb: Math.round(sfEnergyDb * 10) / 10,
    spr: Math.round(spr * 10) / 10,
    sppFreqHz: Math.round(sppFreqHz),
    spectralCentroidHz: Math.round(spectralCentroidHz)
  };
}

// Pomocnicze obliczenie widma mocy
function computePowerSpectrum(signal: number[]): number[] {
  const N = signal.length;
  const powerSpectrum: number[] = [];
  const numBins = Math.floor(N / 2);

  for (let k = 0; k <= numBins; k++) {
    let real = 0;
    let imag = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      const val = signal[n] ?? 0;
      real += val * Math.cos(angle);
      imag -= val * Math.sin(angle);
    }
    powerSpectrum.push((real * real + imag * imag) / N);
  }

  return powerSpectrum;
}

function pitchDiffCents(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.abs(1200 * Math.log2(a / b));
}

// Pełna analiza wibrato
export function analyzeVibratoFull(
  pitchHistory: number[],
  sampleIntervalSec = 0.02
): VibratoAnalysisResult {
  if (pitchHistory.length < 25) {
    return {
      rateHz: 0,
      extentCents: 0,
      extentSemitones: 0,
      onsetDelaySec: 0,
      sinusoidality: 0,
      periodicity: 0,
      harmonicity: 0,
      hasVibrato: false
    };
  }

  const ONSET_THRESHOLD_CENTS = 40;
  let onsetIndex = 0;
  for (let i = 1; i < pitchHistory.length - 1; i++) {
    const d1 = pitchDiffCents(pitchHistory[i] ?? 0, pitchHistory[i - 1] ?? 0);
    const d2 = pitchDiffCents(pitchHistory[i + 1] ?? 0, pitchHistory[i] ?? 0);
    if (d1 > ONSET_THRESHOLD_CENTS && d2 > ONSET_THRESHOLD_CENTS) {
      onsetIndex = i;
      break;
    }
  }
  const onsetDelaySec = onsetIndex * sampleIntervalSec;

  const peaks: number[] = [];
  const activePitches = pitchHistory.slice(onsetIndex);

  for (let i = Math.max(1, onsetIndex); i < pitchHistory.length - 1; i++) {
    const prev = pitchHistory[i - 1] ?? 0;
    const curr = pitchHistory[i] ?? 0;
    const next = pitchHistory[i + 1] ?? 0;
    if (curr > prev && curr > next) peaks.push(i);
  }

  if (peaks.length < 2 || activePitches.length < 10) {
    return {
      rateHz: 0,
      extentCents: 0,
      extentSemitones: 0,
      onsetDelaySec: Math.round(onsetDelaySec * 100) / 100,
      sinusoidality: 0,
      periodicity: 0,
      harmonicity: 0,
      hasVibrato: false
    };
  }

  let periodFramesSum = 0;
  for (let i = 1; i < peaks.length; i++) {
    periodFramesSum += (peaks[i] ?? 0) - (peaks[i - 1] ?? 0);
  }
  const avgPeriodSec = (periodFramesSum / (peaks.length - 1)) * sampleIntervalSec;
  const rateHz = avgPeriodSec > 0 ? 1 / avgPeriodSec : 0;

  const meanPitch = activePitches.reduce((a, b) => a + b, 0) / activePitches.length;

  let extentCentsSum = 0;
  peaks.forEach((pIdx) => {
    const val = pitchHistory[pIdx] ?? meanPitch;
    if (val > 0 && meanPitch > 0) {
      extentCentsSum += Math.abs(1200 * Math.log2(val / meanPitch));
    }
  });
  const extentCents = peaks.length > 0 ? extentCentsSum / peaks.length : 0;
  const extentSemitones = extentCents / 100;

  const zeroMeanPitches = activePitches.map((p) => p - meanPitch);
  const powerSpectrum = computePowerSpectrum(zeroMeanPitches);

  const acPowerSpectrum = powerSpectrum.slice(1);
  const totalPower = acPowerSpectrum.reduce((sum, val) => sum + val, 0);
  const maxPower = acPowerSpectrum.length > 0 ? Math.max(...acPowerSpectrum) : 0;
  const vibs = totalPower > 0 ? maxPower / totalPower : 0;

  let maxCorr = 0;
  const N = zeroMeanPitches.length;
  let energy0 = 0;
  for (let i = 0; i < N; i++) {
    const v = zeroMeanPitches[i] ?? 0;
    energy0 += v * v;
  }

  if (energy0 > 0) {
    const minLag = Math.max(1, Math.floor(0.1 / sampleIntervalSec));
    const maxLag = Math.min(Math.floor(N / 2), Math.ceil(0.3 / sampleIntervalSec));
    for (let lag = minLag; lag <= maxLag; lag++) {
      let r = 0;
      for (let i = 0; i < N - lag; i++) {
        r += (zeroMeanPitches[i] ?? 0) * (zeroMeanPitches[i + lag] ?? 0);
      }
      const normR = r / energy0;
      if (normR > maxCorr) maxCorr = normR;
    }
  }

  let geomProd = 1;
  const specLen = acPowerSpectrum.length;
  for (let i = 0; i < specLen; i++) {
    geomProd *= Math.pow(Math.max(1e-12, acPowerSpectrum[i] ?? 0), 1 / specLen);
  }
  const arithMean = totalPower / Math.max(1, specLen);
  const vibh = arithMean > 0 ? geomProd / arithMean : 0;

  const hasVibrato = extentCents >= 15 && extentCents <= 200 && rateHz >= 4.5 && rateHz <= 7.8;

  return {
    rateHz: Math.round(rateHz * 10) / 10,
    extentCents: Math.round(extentCents),
    extentSemitones: Math.round(extentSemitones * 100) / 100,
    onsetDelaySec: Math.round(onsetDelaySec * 100) / 100,
    sinusoidality: Math.round(vibs * 1000) / 1000,
    periodicity: Math.round(maxCorr * 1000) / 1000,
    harmonicity: Math.round(vibh * 1000) / 1000,
    hasVibrato
  };
}

/**
 * Ewaluacja stopnia zaawansowania 

export function evaluateAdvancementScore(metrics: AcousticMetricsState): { score: number; level: AdvancementLevel } {
  if (metrics.maeCents > 20) {
    return { score: 0, level: 'Amatorski' };
  }

  let score = 0;

  // 1. MAE Intonacji
  if (metrics.maeCents <= 15) score += 2;
  else if (metrics.maeCents <= 20) score += 1;

  // 2. Jitter
  if (metrics.jitterPercent <= 0.35) score += 1;

  // 3. Formant śpiewaka i SPR
  if (metrics.singerFormantEnergyDb >= -22) score += 1.5;
  else if (metrics.singerFormantEnergyDb >= -28) score += 0.5;

  if (metrics.spr >= -14) score += 2;
  else if (metrics.spr >= -19) score += 1;

  // 4. Szum spektralny
  if (metrics.spectralNoiseDb <= -40) score += 1;

  score = Math.max(0, Math.round(score * 10) / 10);

  let level: AdvancementLevel = 'Amatorski';
  if (score >= 4.5) {
    level = 'Zaawansowany';
  } else if (score >= 2.5) {
    level = 'Średniozaawansowany';
  }

  return { score, level };
}
*/

/**
 * Klasyfikator Stylu Śpiewu

export function classifySingingStyleDecision(metrics: AcousticMetricsState): SingingStyle {
  if (metrics.maeCents > 20) {
    return 'Amatorski';
  }

  let choralScore = 0;
  let commercialScore = 0;

  // 1. Błąd intonacji (MAE)
  if (metrics.maeCents <= 14) {
    choralScore += 2;
  } else if (metrics.maeCents > 14 && metrics.maeCents <= 20) {
    commercialScore += 2;
  }

  // 2. Shimmer
  if (metrics.shimmerDb <= 0.20) {
    choralScore += 2;
  } else if (metrics.shimmerDb >= 0.31) {
    commercialScore += 2;
  }

  // 3. HNR
  if (metrics.hnrDb >= 24) {
    choralScore += 1.5;
  } else if (metrics.hnrDb < 21) {
    commercialScore += 1.5;
  }

  // 4. Spectral Centroid
  if (metrics.spectralCentroidHz <= 1400) {
    choralScore += 1.5;
  } else if (metrics.spectralCentroidHz >= 1650) {
    commercialScore += 1.5;
  }

  // 5. SPR
  if (metrics.spr >= -15) {
    commercialScore += 1;
  } else if (metrics.spr < -19) {
    choralScore += 1;
  }

  return choralScore >= commercialScore ? 'Chóralny' : 'Rozrywkowy';
}
*/
export interface SingerClassification {
  level: AdvancementLevel;
  levelScore: number;
  style: SingingStyle;
}

/**  export function classifySinger(metrics: AcousticMetricsState): SingerClassification {
  const { score: levelScore, level } = evaluateAdvancementScore(metrics);
  const style = classifySingingStyleDecision(metrics);
  return { level, levelScore, style };
}
*/

export function midiToNoteName(midi: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const roundedMidi = Math.round(midi);
  const note = noteNames[((roundedMidi % 12) + 12) % 12];
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${note}${octave}`;
}

export function calculateMPFRMetrics(lowMidi: number, highMidi: number): MPFRResult {
  const f0MinHz = 440 * Math.pow(2, (lowMidi - 69) / 12);
  const f0MaxHz = 440 * Math.pow(2, (highMidi - 69) / 12);
  const mpfrSemitones = highMidi - lowMidi;
  const mpfrOctaves = Math.round((mpfrSemitones / 12) * 100) / 100;

  return {
    f0MinHz: Math.round(f0MinHz * 10) / 10,
    f0MaxHz: Math.round(f0MaxHz * 10) / 10,
    f0MinMidi: lowMidi,
    f0MaxMidi: highMidi,
    f0MinNoteName: midiToNoteName(lowMidi),
    f0MaxNoteName: midiToNoteName(highMidi),
    mpfrSemitones,
    mpfrOctaves
  };
}