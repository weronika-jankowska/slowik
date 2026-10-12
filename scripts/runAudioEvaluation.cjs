const fs = require('fs');
const path = require('path');
const wav = require('node-wav');

// --- Szybka implementacja Radix-2 FFT ---
function fft(real, imag) {
  const n = real.length;
  if (n <= 1) return;

  for (let i = 0, j = 0; i < n; i++) {
    if (i < j) {
      const tempR = real[i]; real[i] = real[j]; real[j] = tempR;
      const tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
    }
    let bit = n >> 1;
    while (j >= bit && bit > 0) {
      j -= bit;
      bit >>= 1;
    }
    j += bit;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      for (let j = 0; j < halfLen; j++) {
        const uR = real[i + j];
        const uI = imag[i + j];
        const vR = real[i + j + halfLen] * wR - imag[i + j + halfLen] * wI;
        const vI = real[i + j + halfLen] * wI + imag[i + j + halfLen] * wR;

        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + halfLen] = uR - vR;
        imag[i + j + halfLen] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        const nextWI = wR * wStepI + wI * wStepR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }
}

function calculateRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const val = buffer[i] || 0;
    sum += val * val;
  }
  return Math.sqrt(sum / buffer.length);
}

// Algorytm YIN do śledzenia F0
function pitchYIN(buffer, sampleRate, threshold = 0.15) {
  const bufferSize = Math.floor(buffer.length / 2);
  const yinBuffer = new Float32Array(bufferSize);

  for (let t = 0; t < bufferSize; t++) {
    let sum = 0;
    for (let i = 0; i < bufferSize; i++) {
      const delta = (buffer[i] || 0) - (buffer[i + t] || 0);
      sum += delta * delta;
    }
    yinBuffer[t] = sum;
  }

  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let t = 1; t < bufferSize; t++) {
    runningSum += yinBuffer[t] || 0;
    yinBuffer[t] = runningSum === 0 ? 1 : ((yinBuffer[t] || 0) * t) / runningSum;
  }

  let tau = -1;
  for (let t = 2; t < bufferSize; t++) {
    if ((yinBuffer[t] || 1) < threshold) {
      while (t + 1 < bufferSize && (yinBuffer[t + 1] || 1) < (yinBuffer[t] || 1)) {
        t++;
      }
      tau = t;
      break;
    }
  }

  if (tau === -1) {
    let globalMin = Infinity;
    for (let t = 2; t < bufferSize; t++) {
      if (yinBuffer[t] < globalMin) {
        globalMin = yinBuffer[t];
        tau = t;
      }
    }
    if (globalMin > 0.8 || tau <= 0) return -1;
  }

  let betterTau = tau;
  if (tau > 0 && tau < bufferSize - 1) {
    const s0 = yinBuffer[tau - 1] || 0;
    const s1 = yinBuffer[tau] || 0;
    const s2 = yinBuffer[tau + 1] || 0;
    const denom = 2 * (s0 - 2 * s1 + s2);
    if (Math.abs(denom) > 1e-12) {
      betterTau = tau + (s0 - s2) / denom;
    }
  }

  return sampleRate / betterTau;
}

// Obliczenie HNR na podstawie autokorelacji (zgodnie z metodą Boersma / Praat)
function calculateHNR(buffer, sampleRate, f0) {
  if (f0 <= 0 || buffer.length < 4) return 0;
  const N = buffer.length;
  const targetLag = sampleRate / f0;
  const minLag = Math.max(1, Math.floor(targetLag * 0.75));
  const maxLag = Math.min(Math.floor(N / 2), Math.ceil(targetLag * 1.25));

  if (minLag >= maxLag || maxLag >= N) return 0;

  const windowed = new Float32Array(N);
  let totalEnergy = 0;
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    const val = (buffer[i] || 0) * w;
    windowed[i] = val;
    totalEnergy += val * val;
  }

  if (totalEnergy <= 1e-12) return 0;

  let bestLag = minLag;
  let maxR = -Infinity;
  const rValues = new Float32Array(maxLag - minLag + 3);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;
    for (let i = 0; i < N - lag; i++) {
      const x = windowed[i] || 0;
      const y = windowed[i + lag] || 0;
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    }
    const denom = Math.sqrt(sumXX * sumYY);
    const rNorm = denom > 1e-12 ? sumXY / denom : 0;
    const rIdx = lag - minLag + 1;
    rValues[rIdx] = rNorm;

    if (rNorm > maxR) {
      maxR = rNorm;
      bestLag = lag;
    }
  }

  let r = Math.max(0.001, Math.min(0.9999, maxR));
  return Math.round(10.0 * Math.log10(r / (1.0 - r)) * 10) / 10;
}

// Analiza cykl-do-cyklu: Jitter i Shimmer
function extractGlottalJitterShimmer(signal, sampleRate, meanF0) {
  if (meanF0 <= 60 || meanF0 >= 1200) {
    return { jitterPercent: 1.0, shimmerDb: 0.35 };
  }

  const nominalPeriod = Math.round(sampleRate / meanF0);
  const minPeriod = Math.floor(nominalPeriod * 0.75);
  const maxPeriod = Math.ceil(nominalPeriod * 1.25);

  const peakIndices = [];
  let idx = 0;

  for (let i = 1; i < Math.min(signal.length - 1, nominalPeriod * 2); i++) {
    if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1] && signal[i] > 0.01) {
      peakIndices.push(i);
      idx = i;
      break;
    }
  }

  while (idx + minPeriod < signal.length) {
    const searchStart = idx + minPeriod;
    const searchEnd = Math.min(signal.length - 1, idx + maxPeriod);
    let maxVal = -Infinity;
    let bestIdx = -1;

    for (let j = searchStart; j <= searchEnd; j++) {
      if (signal[j] > maxVal && signal[j] > signal[j - 1] && signal[j] > signal[j + 1]) {
        maxVal = signal[j];
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

  if (peakIndices.length < 8) {
    return { jitterPercent: 1.5, shimmerDb: 0.4 };
  }

  const periods = [];
  const amplitudes = [];
  for (let i = 0; i < peakIndices.length; i++) {
    amplitudes.push(Math.abs(signal[peakIndices[i]]));
    if (i > 0) {
      periods.push((peakIndices[i] - peakIndices[i - 1]) / sampleRate);
    }
  }

  // Jitter relatywny
  let diffPeriodSum = 0;
  let periodSum = 0;
  for (let i = 1; i < periods.length; i++) {
    diffPeriodSum += Math.abs(periods[i] - periods[i - 1]);
    periodSum += periods[i];
  }
  periodSum += periods[0];
  const avgP = periodSum / periods.length;
  const jitterPercent = avgP > 0 ? ((diffPeriodSum / (periods.length - 1)) / avgP) * 100 : 0;

  // Shimmer w dB
  let shimmerSum = 0;
  let validPairs = 0;
  for (let i = 1; i < amplitudes.length; i++) {
    const a1 = amplitudes[i - 1] || 1e-4;
    const a2 = amplitudes[i] || 1e-4;
    shimmerSum += Math.abs(20 * Math.log10(a2 / a1));
    validPairs++;
  }
  const shimmerDb = validPairs > 0 ? shimmerSum / validPairs : 0.25;

  return {
    jitterPercent: Math.round(jitterPercent * 100) / 100,
    shimmerDb: Math.round(shimmerDb * 100) / 100
  };
}

// Analiza wibrato
function analyzeVibratoFull(pitchHistory, sampleIntervalSec = 0.02) {
  if (pitchHistory.length < 20) {
    return { rateHz: 0, extentCents: 0, extentSemitones: 0, onsetDelaySec: 0, hasVibrato: false };
  }

  let onsetIndex = 0;
  for (let i = 1; i < pitchHistory.length - 1; i++) {
    const d1 = Math.abs(pitchHistory[i] - pitchHistory[i - 1]);
    const d2 = Math.abs(pitchHistory[i + 1] - pitchHistory[i]);
    if (d1 > 1.0 && d2 > 1.0) {
      onsetIndex = i;
      break;
    }
  }
  const onsetDelaySec = onsetIndex * sampleIntervalSec;

  const peaks = [];
  for (let i = Math.max(1, onsetIndex); i < pitchHistory.length - 1; i++) {
    const prev = pitchHistory[i - 1] || 0;
    const curr = pitchHistory[i] || 0;
    const next = pitchHistory[i + 1] || 0;
    if (curr > prev && curr > next) peaks.push(i);
  }

  if (peaks.length < 2) {
    return { rateHz: 0, extentCents: 0, extentSemitones: 0, onsetDelaySec: Math.round(onsetDelaySec * 100) / 100, hasVibrato: false };
  }

  let periodFramesSum = 0;
  for (let i = 1; i < peaks.length; i++) {
    periodFramesSum += (peaks[i] - peaks[i - 1]);
  }
  const avgPeriodSec = (periodFramesSum / (peaks.length - 1)) * sampleIntervalSec;
  const rateHz = avgPeriodSec > 0 ? 1 / avgPeriodSec : 0;

  const activePitches = pitchHistory.slice(onsetIndex);
  const meanPitch = activePitches.reduce((a, b) => a + b, 0) / activePitches.length;

  let extCentsSum = 0;
  peaks.forEach(pIdx => {
    const val = pitchHistory[pIdx] || meanPitch;
    if (val > 0 && meanPitch > 0) {
      extCentsSum += Math.abs(1200 * Math.log2(val / meanPitch));
    }
  });
  const extentCents = peaks.length > 0 ? extCentsSum / peaks.length : 0;
  const extentSemitones = extentCents / 100;
  const hasVibrato = extentCents >= 20 && extentCents <= 180 && rateHz >= 3.8 && rateHz <= 8.0;

  return {
    rateHz: Math.round(rateHz * 10) / 10,
    extentCents: Math.round(extentCents),
    extentSemitones: Math.round(extentSemitones * 100) / 100,
    onsetDelaySec: Math.round(onsetDelaySec * 100) / 100,
    hasVibrato
  };
}

// Analiza spektralna (SPR, Centroid, Pasmo formantu śpiewaczego)
function computeFFTSpectrumMetrics(signal, sampleRate, f0) {
  const N = 2048;
  const halfN = N / 2;
  const binHz = (sampleRate / 2) / halfN;

  const start = Math.max(0, Math.floor(signal.length / 2) - halfN);
  const real = new Float32Array(N);
  const imag = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    real[i] = (signal[start + i] || 0) * w;
    imag[i] = 0;
  }

  fft(real, imag);

  const magnitudes = new Float32Array(halfN);
  let totalLinEnergy = 0;
  let weightedFreqSum = 0;

  for (let k = 0; k < halfN; k++) {
    const r = real[k];
    const im = imag[k];
    const power = (r * r + im * im) / (N * N);
    const mag = Math.sqrt(power);
    magnitudes[k] = 20 * Math.log10(mag + 1e-7);

    const f = k * binHz;
    totalLinEnergy += power;
    weightedFreqSum += f * power;
  }

  let maxLowHarmonicDb = -Infinity;
  let maxHighHarmonicDb = -Infinity;
  let sfSum = 0;
  let sfCount = 0;

  for (let k = 1; k < halfN - 1; k++) {
    const f = k * binHz;
    const db = magnitudes[k] || -120;
    const prevDb = magnitudes[k - 1] || -120;
    const nextDb = magnitudes[k + 1] || -120;
    const isPeak = db > prevDb && db > nextDb;

    if (f >= 50 && f <= 2000 && isPeak && db > maxLowHarmonicDb) {
      maxLowHarmonicDb = db;
    }
    if (f >= 2000 && f <= 4000 && isPeak && db > maxHighHarmonicDb) {
      maxHighHarmonicDb = db;
    }
    if (f >= 2500 && f <= 3500) {
      sfSum += db;
      sfCount++;
    }
  }

  if (maxLowHarmonicDb === -Infinity) maxLowHarmonicDb = -35;
  if (maxHighHarmonicDb === -Infinity) maxHighHarmonicDb = -55;

  const spr = maxHighHarmonicDb - maxLowHarmonicDb;
  const singerFormantEnergyDb = sfCount > 0 ? sfSum / sfCount : -45;
  const spectralCentroidHz = totalLinEnergy > 0 ? weightedFreqSum / totalLinEnergy : 1200;

  let noiseSum = 0;
  let noiseCount = 0;
  for (let h = 1; h <= 5; h++) {
    const valleyFreq = f0 * (h + 0.5);
    if (valleyFreq < sampleRate / 2) {
      const bin = Math.round(valleyFreq / binHz);
      if (bin < halfN) {
        noiseSum += magnitudes[bin] || -100;
        noiseCount++;
      }
    }
  }
  const spectralNoiseDb = noiseCount > 0 ? noiseSum / noiseCount : -45;

  return { singerFormantEnergyDb, spr, spectralNoiseDb, spectralCentroidHz };
}

// Ocena poziomu zaawansowania i stylu
function classifySingingStyle(metrics, vowel, groundTruthStyle) {
  let score = 0;

  if (metrics.maeCents <= 15) score += 3.5;
  else if (metrics.maeCents <= 25) score += 2.0;
  else if (metrics.maeCents <= 35) score += 1.0;

  if (metrics.pitchStdDevCents <= 14) score += 2.5;
  else if (metrics.pitchStdDevCents <= 22) score += 1.5;

  if (metrics.hnrDb >= 15) score += 2.0;
  else if (metrics.hnrDb >= 11) score += 1.0;

  if (metrics.jitterPercent <= 1.5) score += 1.0;
  if (metrics.shimmerDb <= 0.35) score += 1.0;

  score = Math.round(score * 10) / 10;
  let advLevel = 'Amatorski';
  if (score >= 6.5) advLevel = 'Zaawansowany';
  else if (score >= 4.0) advLevel = 'Średniozaawansowany';

  // Amatorski styl przy dużym fałszu lub niestabilności
  if (metrics.maeCents >= 38 || (metrics.maeCents >= 25 && metrics.pitchStdDevCents >= 22)) {
    return {
      style: 'Amatorski',
      advScore: score,
      advLevel: 'Amatorski',
      choralScore: 0,
      commercialScore: 0,
      cause: `Błąd intonacji (MAE: ${metrics.maeCents}c, StdDev: ${metrics.pitchStdDevCents}c)`
    };
  }

  let ptsChor = 0.0;
  let ptsRozr = 0.0;
  let ptsAmat = 0.0;

  // 1. Intonacja
  if (metrics.maeCents <= 14) ptsChor += 2.5;
  else if (metrics.maeCents <= 28) ptsRozr += 2.0;
  else ptsAmat += 2.5;

  // 2. Szum harmoniczny (HNR)
  if (metrics.hnrDb >= 17) {
    ptsChor += 2.5;
  } else if (metrics.hnrDb <= 13) {
    ptsRozr += 2.5;
  } else {
    ptsChor += 1.0;
    ptsRozr += 1.0;
  }

  // 3. Jasność widma (Spectral Centroid)
  if (metrics.spectralCentroidHz <= 1450) {
    ptsChor += 2.0;
  } else if (metrics.spectralCentroidHz >= 1700) {
    ptsRozr += 2.5;
  } else {
    ptsChor += 1.0;
    ptsRozr += 1.0;
  }

  // 4. Singing Power Ratio (SPR)
  if (metrics.spr >= -16) {
    ptsRozr += 2.0;
  } else {
    ptsChor += 1.5;
  }

  // 5. Shimmer
  if (metrics.shimmerDb <= 0.25) ptsChor += 1.5;
  else if (metrics.shimmerDb >= 0.35) ptsRozr += 1.5;

  const scores = { 'Chóralny': ptsChor, 'Rozrywkowy': ptsRozr, 'Amatorski': ptsAmat };
  const style = Object.keys(scores).reduce((a, b) => scores[a] >= scores[b] ? a : b);

  let cause = 'Zgodny';
  if (groundTruthStyle !== 'Nieznany' && style !== groundTruthStyle) {
    cause = `Chor:${ptsChor.toFixed(1)}, Rozr:${ptsRozr.toFixed(1)}, Amat:${ptsAmat.toFixed(1)} | MAE:${metrics.maeCents}c, Centroid:${metrics.spectralCentroidHz}Hz, HNR:${metrics.hnrDb}dB`;
  }

  return {
    style,
    advScore: score,
    advLevel,
    choralScore: ptsChor,
    commercialScore: ptsRozr,
    cause
  };
}

function parseGroundTruthStyle(code) {
  const n = (code || '').toLowerCase().trim();
  if (n === 'a' || n === 'amator' || n === 'amatorski') return 'Amatorski';
  if (n === 'c' || n === 'ch' || n === 'choral' || n === 'choralny' || n === 'chóralny') return 'Chóralny';
  if (n === 'r' || n === 'rozrywkowy' || n === 'rozrywka') return 'Rozrywkowy';
  return 'Nieznany';
}

const CDUR_SCALE_MIDI = { 1: 60, 2: 62, 3: 64, 4: 65, 5: 67, 6: 69, 7: 71, 8: 72 };

function getTargetMidiFromFilename(filename) {
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const parts = baseName.split('_');
  const lastPart = parts[parts.length - 1];
  const scaleDegree = parseInt(lastPart, 10);
  if (!isNaN(scaleDegree) && CDUR_SCALE_MIDI[scaleDegree]) {
    return CDUR_SCALE_MIDI[scaleDegree];
  }
  return null;
}

function findBestOctaveTarget(measuredF0, baseTargetFreq) {
  let target = baseTargetFreq;
  while (measuredF0 < target * 0.707) target /= 2;
  while (measuredF0 > target * 1.414) target *= 2;
  return target;
}

function processAudioFile(filePath, folder, filename) {
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const parts = baseName.split('_');
  const rawStyleCode = parts[1] || 'unknown';
  const vowel = (parts[2] || 'A').toUpperCase();
  const groundTruthStyle = parseGroundTruthStyle(rawStyleCode);

  const fileBuffer = fs.readFileSync(filePath);
  const decoded = wav.decode(fileBuffer);

  let channelData;
  if (decoded.channelData.length > 1) {
    const left = decoded.channelData[0];
    const right = decoded.channelData[1];
    channelData = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      channelData[i] = (left[i] + right[i]) / 2;
    }
  } else {
    channelData = decoded.channelData[0] || new Float32Array();
  }

  const sampleRate = decoded.sampleRate;
  const frameSize = 2048;
  const hopSize = Math.floor(sampleRate * 0.02);
  const rawPitches = [];

  for (let offset = 0; offset + frameSize < channelData.length; offset += hopSize) {
    const frame = channelData.subarray(offset, offset + frameSize);
    const rms = calculateRMS(frame);

    if (rms > 0.012) {
      const f0 = pitchYIN(frame, sampleRate, 0.15);
      if (f0 > 65 && f0 < 1100) {
        rawPitches.push(f0);
      }
    }
  }

  if (rawPitches.length < 15) return null;

  // Obcięcie pierwszych i ostatnich 15% próbek (faza ataku i wybrzmienia głosu)
  const trimStart = Math.floor(rawPitches.length * 0.15);
  const trimEnd = Math.max(trimStart + 5, Math.floor(rawPitches.length * 0.85));
  const pitches = rawPitches.slice(trimStart, trimEnd);

  const medianPitch = [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)];
  let centsVarianceSum = 0;
  pitches.forEach(p => {
    const dCents = 1200 * Math.log2(p / medianPitch);
    centsVarianceSum += dCents * dCents;
  });
  const pitchStdDevCents = Math.round(Math.sqrt(centsVarianceSum / pitches.length) * 10) / 10;
  const meanF0 = pitches.reduce((a, b) => a + b, 0) / pitches.length;

  const targetMidi = getTargetMidiFromFilename(filename);
  let targetFreq = 440;
  let maeCents = 0;

  if (targetMidi !== null) {
    const nominalFreq = 440 * Math.pow(2, (targetMidi - 69) / 12);
    targetFreq = findBestOctaveTarget(meanF0, nominalFreq);
    maeCents = Math.abs(1200 * Math.log2(meanF0 / targetFreq));
  } else {
    const nearestMidi = Math.round(69 + 12 * Math.log2(meanF0 / 440));
    targetFreq = 440 * Math.pow(2, (nearestMidi - 69) / 12);
    maeCents = Math.abs(1200 * Math.log2(meanF0 / targetFreq));
  }

  // Wycinek steady-state sygnału czasowego do HNR i formantu
  const audioSampleStart = Math.floor(channelData.length * 0.2);
  const audioSampleEnd = Math.floor(channelData.length * 0.8);
  const steadySignal = channelData.subarray(audioSampleStart, audioSampleEnd);

  const glottalMetrics = extractGlottalJitterShimmer(steadySignal, sampleRate, meanF0);
  const hnrDb = calculateHNR(steadySignal, sampleRate, meanF0);
  const vib = analyzeVibratoFull(pitches, 0.02);
  const fftMetrics = computeFFTSpectrumMetrics(steadySignal, sampleRate, meanF0);

  const acousticState = {
    f0: Math.round(meanF0 * 10) / 10,
    maeCents: Math.round(maeCents * 10) / 10,
    pitchStdDevCents,
    jitterPercent: glottalMetrics.jitterPercent,
    shimmerDb: glottalMetrics.shimmerDb,
    hnrDb,
    spectralNoiseDb: Math.round(fftMetrics.spectralNoiseDb * 10) / 10,
    spectralCentroidHz: Math.round(fftMetrics.spectralCentroidHz),
    singerFormantEnergyDb: Math.round(fftMetrics.singerFormantEnergyDb * 10) / 10,
    spr: Math.round(fftMetrics.spr * 10) / 10,
    vibrato: vib
  };

  const classification = classifySingingStyle(acousticState, vowel, groundTruthStyle);
  const isCorrect = groundTruthStyle !== 'Nieznany' && classification.style === groundTruthStyle;

  return {
    folder,
    filename,
    vowel,
    targetFreqHz: Math.round(targetFreq * 10) / 10,
    groundTruthStyle,
    predictedStyle: classification.style,
    isCorrect,
    advancement: classification.advLevel,
    score: classification.advScore,
    choralPoints: classification.choralScore,
    commercialPoints: classification.commercialScore,
    failureCause: classification.cause,
    f0: acousticState.f0,
    maeCents: acousticState.maeCents,
    pitchStdDevCents: acousticState.pitchStdDevCents,
    jitterPercent: acousticState.jitterPercent,
    shimmerDb: acousticState.shimmerDb,
    hnrDb: acousticState.hnrDb,
    spectralNoiseDb: acousticState.spectralNoiseDb,
    spectralCentroidHz: acousticState.spectralCentroidHz,
    sflDb: acousticState.singerFormantEnergyDb,
    sprDb: acousticState.spr,
    vibRateHz: acousticState.vibrato.rateHz,
    vibExtentCents: acousticState.vibrato.extentCents,
    vibExtentST: acousticState.vibrato.extentSemitones,
    vibDelaySec: acousticState.vibrato.onsetDelaySec
  };
}

function main() {
  const audioDir = path.join(process.cwd(), 'audio');
  const outputFile = path.join(process.cwd(), 'wyniki_zbiorcze.csv');

  console.log(`\nRozpoczynanie uaktualnionej analizy próbek w: ${audioDir}`);

  if (!fs.existsSync(audioDir)) {
    console.error(`BŁĄD: Nie znaleziono katalogu audio w ${audioDir}.`);
    return;
  }

  const results = [];
  const folders = fs.readdirSync(audioDir).filter(f => {
    try { return fs.statSync(path.join(audioDir, f)).isDirectory(); } catch { return false; }
  });

  folders.sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  let processedCount = 0;

  for (const folder of folders) {
    const folderPath = path.join(audioDir, folder);
    const files = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.wav'));

    for (const file of files) {
      const fullPath = path.join(folderPath, file);
      try {
        const res = processAudioFile(fullPath, folder, file);
        if (res) {
          results.push(res);
          processedCount++;
          const status = res.isCorrect ? '✓ OK' : `✗ BŁĄD (${res.failureCause})`;
          console.log(`[${processedCount}] ${folder}/${file} | Prawda: ${res.groundTruthStyle} -> Wykryto: ${res.predictedStyle} | ${status}`);
        }
      } catch (err) {
        console.error(`Błąd w pliku ${folder}/${file}:`, err.message);
      }
    }
  }

  const headers = [
    'Folder', 'Plik', 'Samogloska', 'TargetFreq_Hz', 'Prawdziwy_Styl', 'Wykryty_Styl', 'Zgodnosc_Stylu',
    'Przyczyna_Bledu', 'Punkty_Chor', 'Punkty_Rozr',
    'Poziom_Zaawansowania', 'Punkty_Ocena', 'F0_Hz', 'MAE_Centy', 'Pitch_StdDev_Centy', 'Jitter_pct', 'Shimmer_dB',
    'HNR_dB', 'Szum_Spektralny_dB', 'SpectralCentroid_Hz', 'SFL_dB', 'SPR_dB', 'Wibrato_Rate_Hz',
    'Wibrato_Extent_Cents', 'Wibrato_Extent_ST', 'Wibrato_Delay_s'
  ];

  const csvRows = [headers.join(',')];
  for (const r of results) {
    csvRows.push([
      r.folder, r.filename, r.vowel, r.targetFreqHz, r.groundTruthStyle, r.predictedStyle,
      r.isCorrect ? 'TAK' : 'NIE', `"${r.failureCause}"`, r.choralPoints, r.commercialPoints,
      r.advancement, r.score, r.f0, r.maeCents, r.pitchStdDevCents, r.jitterPercent, r.shimmerDb,
      r.hnrDb, r.spectralNoiseDb, r.spectralCentroidHz, r.sflDb, r.sprDb, r.vibRateHz,
      r.vibExtentCents, r.vibExtentST, r.vibDelaySec
    ].join(','));
  }

  fs.writeFileSync(outputFile, csvRows.join('\n'), 'utf-8');

  const validSamples = results.filter(r => r.groundTruthStyle !== 'Nieznany');
  const incorrectSamples = validSamples.filter(r => !r.isCorrect);
  const correctCount = validSamples.length - incorrectSamples.length;
  const accuracyTotal = validSamples.length > 0 ? (correctCount / validSamples.length) * 100 : 0;

  console.log('\n================ RAPORT SKUTECZNOŚCI DLA POJEDYNCZYCH PRÓBEK ================');
  console.log(`Przeanalizowano łącznie: ${results.length} próbek`);
  console.log(`Poprawnie sklasyfikowane pojedyncze nuty: ${correctCount} / ${validSamples.length} (${accuracyTotal.toFixed(2)}%)`);

  console.log('\n================ RAPORT SKUTECZNOŚCI DLA WOKALISTÓW (PROFIL UŻYTKOWNIKA) ================');
  const folderMap = {};
  for (const r of results) {
    if (!folderMap[r.folder]) {
      folderMap[r.folder] = { trueStyle: r.groundTruthStyle, votes: {} };
    }
    folderMap[r.folder].votes[r.predictedStyle] = (folderMap[r.folder].votes[r.predictedStyle] || 0) + 1;
  }

  let correctUsers = 0;
  let totalUsers = 0;
  for (const [folder, data] of Object.entries(folderMap)) {
    totalUsers++;
    const bestStyle = Object.keys(data.votes).reduce((a, b) => data.votes[a] >= data.votes[b] ? a : b);
    const isOk = bestStyle === data.trueStyle;
    if (isOk) correctUsers++;
    console.log(`Wokalista ${folder} | Prawda: ${data.trueStyle.padEnd(10)} -> Profil wyliczony: ${bestStyle.padEnd(10)} | ${isOk ? '✓ OK' : '✗ BŁĄD'}`);
  }
  console.log('------------------------------------------------------------------------------------------');
  console.log(`Skuteczność profilowania użytkownika: ${correctUsers} / ${totalUsers} (${((correctUsers/totalUsers)*100).toFixed(1)}%)\n`);
}

main();