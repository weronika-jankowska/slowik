// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wav from 'node-wav';

import {
  pitchYIN,
  extractGlottalCycles,
  calculateJitterShimmerCycleToCycle,
  calculateHNR,
  analyzeVibratoFull,
  medianOfValid
} from '../src/utils/audioMetrics.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIO_DIR = path.resolve(__dirname, '../audio');
const CSV_PATH = path.resolve(__dirname, '../features_summary_4.csv');
const OUTPUT_REPORT_PATH = path.resolve(__dirname, '../comparison_report.csv');

// Oczekiwane nominalne częstotliwości dźwięków 1-8 (skala C4 - C5)
const EXPECTED_PITCH_HZ: Record<string, number> = {
  '1': 261.63, // C4
  '2': 293.66, // D4
  '3': 329.63, // E4
  '4': 349.23, // F4
  '5': 392.00, // G4
  '6': 440.00, // A4
  '7': 493.88, // H4 (B4)
  '8': 523.25  // C5
};

function parseCsv(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Nie znaleziono pliku CSV: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  const headers = lines[0].split(',').map(h => h.trim());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row: Record<string, string> = { _rowIndex: String(i - 1) };
    headers.forEach((h, idx) => {
      row[h] = values[idx]?.trim() ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = re[i]; re[i] = re[j]; re[j] = tempR;
      const tempI = im[i]; im[i] = im[j]; im[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < half; k++) {
        const posEven = i + k;
        const posOdd = i + k + half;
        const uR = re[posEven];
        const uI = im[posEven];
        const vR = re[posOdd] * wR - im[posOdd] * wI;
        const vI = re[posOdd] * wI + im[posOdd] * wR;

        re[posEven] = uR + vR;
        im[posEven] = uI + vI;
        re[posOdd] = uR - vR;
        im[posOdd] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }
}

function computeFastPowerSpectrum(signal: Float32Array, fftSize = 4096): Float32Array {
  const numBins = fftSize / 2;
  const outDb = new Float32Array(numBins);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  const N = Math.min(signal.length, fftSize);
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    re[i] = (signal[i] ?? 0) * w;
  }

  fftRadix2(re, im);

  for (let k = 0; k < numBins; k++) {
    const r = re[k];
    const m = im[k];
    const power = (r * r + m * m) / (N * N);
    outDb[k] = 10 * Math.log10(Math.max(1e-12, power));
  }

  return outDb;
}

function calculateOfflineSPR(freqDb: Float32Array, sampleRate: number, f0: number) {
  const numBins = freqDb.length;
  const binHz = (sampleRate / 2) / numBins;

  let maxLowDb = -Infinity;
  let maxHighDb = -Infinity;
  const peakSpan = f0 > 60 ? Math.max(1, Math.round((0.35 * f0) / binHz)) : 2;

  const isPeak = (i: number): boolean => {
    const v = freqDb[i] ?? -Infinity;
    for (let k = 1; k <= peakSpan; k++) {
      if (i - k < 0 || i + k >= numBins) return false;
      if ((freqDb[i - k] ?? -Infinity) >= v || (freqDb[i + k] ?? -Infinity) > v) return false;
    }
    return true;
  };

  for (let i = 1; i < numBins - 1; i++) {
    const f = i * binHz;
    const val = freqDb[i] ?? -120;
    if (f >= 50 && f <= 2000 && isPeak(i) && val > maxLowDb) maxLowDb = val;
    if (f >= 2000 && f <= 4000 && isPeak(i) && val > maxHighDb) maxHighDb = val;
  }

  // W referencji SPR w skali liniowej to iloraz mocy P_high / P_low (10^(deltaDb / 10))
  const diffDb = (Number.isFinite(maxHighDb) && Number.isFinite(maxLowDb)) ? (maxHighDb - maxLowDb) : NaN;
  const sprLinear = Number.isFinite(diffDb) ? Math.pow(10, diffDb / 10) : NaN;
  return { sprDb: diffDb, sprLinear };
}

// Funkcja dopasowująca pliki do schematu: nazwa-folderu_styl_samogłoska-dźwięk
function parseFilenameDetails(filename: string) {
  const base = path.basename(filename, '.wav');
  const parts = base.split('_');
  if (parts.length >= 3) {
    const folder = parts[0]; // p1 .. p20
    const style = parts[1];  // a, ch, r
    const notePart = parts[2].split('-');
    const vowel = notePart[0]; // a, e, i, o, u
    const noteId = notePart[1]; // 1 .. 8
    return { folder, style, vowel, noteId };
  }
  return null;
}

async function runBenchmark() {
  console.log("Ładowanie pliku CSV...");
  const csvRows = parseCsv(CSV_PATH);
  console.log(`Załadowano ${csvRows.length} wierszy referencyjnych.\n`);

  // Zbieranie wszystkich plików WAV z folderów p1-p20
  const wavFiles: string[] = [];
  for (let p = 1; p <= 20; p++) {
    const pFolder = path.join(AUDIO_DIR, `p${p}`);
    if (fs.existsSync(pFolder)) {
      const files = fs.readdirSync(pFolder).filter(f => f.endsWith('.wav'));
      // Sortowanie: alfabetycznie po samogłosce, a następnie numerycznie po dźwięku (1-8)
      files.sort((a, b) => {
        const da = parseFilenameDetails(a);
        const db = parseFilenameDetails(b);
        if (da && db) {
          if (da.vowel !== db.vowel) return da.vowel.localeCompare(db.vowel);
          return parseInt(da.noteId, 10) - parseInt(db.noteId, 10);
        }
        return a.localeCompare(b);
      });
      files.forEach(f => wavFiles.push(path.join(pFolder, f)));
    }
  }

  console.log(`Znaleziono ${wavFiles.length} plików WAV w strukturze katalogów.`);
  if (wavFiles.length === 0) {
    console.error(`Brak plików WAV w katalogu: ${AUDIO_DIR}`);
    return;
  }

  const results: any[] = [];
  let csvPointer = 0;

  console.log(`Rozpoczynam analizę i dopasowywanie do pliku CSV...\n`);

  for (let fileIdx = 0; fileIdx < wavFiles.length; fileIdx++) {
    if (csvPointer >= csvRows.length) break;

    const filePath = wavFiles[fileIdx];
    const filename = path.basename(filePath);
    const details = parseFilenameDetails(filename);

    const fileBuffer = fs.readFileSync(filePath);
    const audioData = (wav.default || wav).decode(fileBuffer);
    const sampleRate = audioData.sampleRate;
    const channelData = audioData.channelData[0];

    const stepSize = Math.floor(sampleRate * 0.040);
    const windowSize = 4096; // 4096 próbek zapewnia pełne pasmo dla niskich rejestrów
    const f0Values: number[] = [];
    const timeValues: number[] = [];
    const jitterValues: number[] = [];
    const shimmerValues: number[] = [];

    let curTime = 0;
    for (let offset = 0; offset + windowSize <= channelData.length; offset += stepSize) {
      const subBuffer = channelData.subarray(offset, offset + windowSize);

      let sumSq = 0;
      for (let s = 0; s < subBuffer.length; s += 4) {
        const v = subBuffer[s] ?? 0;
        sumSq += v * v;
      }
      const approxRms = Math.sqrt((sumSq * 4) / subBuffer.length);
      if (approxRms < 0.015) {
        curTime += 0.040;
        continue;
      }

      const curF0 = pitchYIN(subBuffer, sampleRate, 0.15);
      if (curF0 >= 50 && curF0 <= 1100) {
        f0Values.push(curF0);
        timeValues.push(curTime);

        const cycles = extractGlottalCycles(subBuffer, sampleRate, curF0);
        const pert = calculateJitterShimmerCycleToCycle(cycles.periods, cycles.peakAmplitudes);
        if (Number.isFinite(pert.jitterPercent)) jitterValues.push(pert.jitterPercent);
        if (Number.isFinite(pert.shimmerDb)) shimmerValues.push(pert.shimmerDb);
      }
      curTime += 0.040;
    }

    const computed_F0 = medianOfValid(f0Values);
    const computed_Jitter = medianOfValid(jitterValues);
    const computed_Shimmer = medianOfValid(shimmerValues);

    const midStart = Math.max(0, Math.floor(channelData.length / 2) - 2048);
    const midBuffer = channelData.subarray(midStart, Math.min(channelData.length, midStart + 4096));
    const dftDb = computeFastPowerSpectrum(midBuffer, 4096);
    const { sprLinear } = calculateOfflineSPR(dftDb, sampleRate, computed_F0);

    const vib = analyzeVibratoFull(f0Values, 0.040, timeValues);

    // Mechanizm synchronizacji: sprawdzenie czy bieżący wiersz CSV pasuje tonem i stylem
    let expected = csvRows[csvPointer];
    let exp_F0 = parseFloat(expected['mean_F0'] || 'NaN');
    let expectedType = expected['type'];

    // Jeśli wykryto rozbieżność (brakujący plik w CSV), przesuwamy synchronizację
    if (details && computed_F0 > 0 && Math.abs(1200 * Math.log2(computed_F0 / exp_F0)) > 300) {
      const nextExp = csvRows[csvPointer + 1];
      if (nextExp) {
        const nextF0 = parseFloat(nextExp['mean_F0'] || 'NaN');
        if (Math.abs(1200 * Math.log2(computed_F0 / nextF0)) < 150) {
          csvPointer++;
          expected = csvRows[csvPointer];
          exp_F0 = nextF0;
          expectedType = expected['type'];
        }
      }
    }

    const exp_Jitter = parseFloat(expected['localJitter'] || 'NaN');
    const exp_Shimmer = parseFloat(expected['localdbShimmer'] || 'NaN');
    const exp_SPR = parseFloat(expected['spr'] || 'NaN');
    const exp_VibFreq = parseFloat(expected['vibrato_frequency'] || 'NaN');

    const diffCents = (computed_F0 > 0 && exp_F0 > 0)
      ? Math.abs(1200 * Math.log2(computed_F0 / exp_F0))
      : NaN;

    results.push({
      filename,
      expectedType,
      actualStyle: details?.style ?? '',
      expected_F0: exp_F0,
      computed_F0,
      diff_F0_cents: diffCents,
      expected_Jitter: exp_Jitter,
      computed_Jitter,
      expected_Shimmer: exp_Shimmer,
      computed_Shimmer,
      expected_SPR_linear: exp_SPR,
      computed_SPR_linear: sprLinear,
      expected_VibFreq: exp_VibFreq,
      computed_VibFreq: vib.rateHz
    });

    csvPointer++;

    if ((results.length) % 100 === 0 || fileIdx === wavFiles.length - 1) {
      console.log(`Przetworzono ${results.length} próbek...`);
    }
  }

  printStatisticsSummary(results);
  saveReportCsv(results, OUTPUT_REPORT_PATH);
}

function printStatisticsSummary(results: any[]) {
  const validF0Diffs = results.map(r => r.diff_F0_cents).filter(Number.isFinite);
  const avgF0ErrorCents = validF0Diffs.reduce((a, b) => a + b, 0) / Math.max(1, validF0Diffs.length);

  const jitterDiffs = results
    .filter(r => Number.isFinite(r.expected_Jitter) && Number.isFinite(r.computed_Jitter))
    .map(r => Math.abs(r.expected_Jitter - r.computed_Jitter));
  const avgJitterDiff = jitterDiffs.reduce((a, b) => a + b, 0) / Math.max(1, jitterDiffs.length);

  const shimmerDiffs = results
    .filter(r => Number.isFinite(r.expected_Shimmer) && Number.isFinite(r.computed_Shimmer))
    .map(r => Math.abs(r.expected_Shimmer - r.computed_Shimmer));
  const avgShimmerDiff = shimmerDiffs.reduce((a, b) => a + b, 0) / Math.max(1, shimmerDiffs.length);

  const sprDiffs = results
    .filter(r => Number.isFinite(r.expected_SPR_linear) && Number.isFinite(r.computed_SPR_linear))
    .map(r => Math.abs(r.expected_SPR_linear - r.computed_SPR_linear));
  const avgSprDiff = sprDiffs.reduce((a, b) => a + b, 0) / Math.max(1, sprDiffs.length);

  console.log("\n================ PODSUMOWANIE PORÓWNANIA ================");
  console.log(`Liczba poprawnie dopasowanych próbek: ${results.length}`);
  console.log(`1. Średni błąd intonacji (F0): ±${avgF0ErrorCents.toFixed(2)} centów (oczekiwany < 10 centów)`);
  console.log(`2. Średnia różnica bezwzględna Jitter: ±${avgJitterDiff.toFixed(3)}% (oczekiwana < 0.08%)`);
  console.log(`3. Średnia różnica bezwzględna Shimmer: ±${avgShimmerDiff.toFixed(3)} dB (oczekiwana < 0.10 dB)`);
  console.log(`4. Średnia różnica liniowego SPR: ±${avgSprDiff.toFixed(4)}`);
  console.log("========================================================\n");
}

function saveReportCsv(results: any[], outPath: string) {
  const headers = [
    'filename', 'expectedType', 'actualStyle',
    'expected_F0', 'computed_F0', 'diff_F0_cents',
    'expected_Jitter', 'computed_Jitter',
    'expected_Shimmer', 'computed_Shimmer',
    'expected_SPR_linear', 'computed_SPR_linear',
    'expected_VibFreq', 'computed_VibFreq'
  ];

  const lines = [headers.join(',')];
  for (const r of results) {
    lines.push([
      r.filename,
      r.expectedType ?? '',
      r.actualStyle ?? '',
      Number.isFinite(r.expected_F0) ? r.expected_F0.toFixed(2) : '',
      Number.isFinite(r.computed_F0) ? r.computed_F0.toFixed(2) : '',
      Number.isFinite(r.diff_F0_cents) ? r.diff_F0_cents.toFixed(2) : '',
      Number.isFinite(r.expected_Jitter) ? r.expected_Jitter.toFixed(4) : '',
      Number.isFinite(r.computed_Jitter) ? r.computed_Jitter.toFixed(4) : '',
      Number.isFinite(r.expected_Shimmer) ? r.expected_Shimmer.toFixed(4) : '',
      Number.isFinite(r.computed_Shimmer) ? r.computed_Shimmer.toFixed(4) : '',
      Number.isFinite(r.expected_SPR_linear) ? r.expected_SPR_linear.toFixed(4) : '',
      Number.isFinite(r.computed_SPR_linear) ? r.computed_SPR_linear.toFixed(4) : '',
      Number.isFinite(r.expected_VibFreq) ? r.expected_VibFreq.toFixed(2) : '',
      Number.isFinite(r.computed_VibFreq) ? r.computed_VibFreq.toFixed(2) : ''
    ].join(','));
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`Raport porównawczy zapisano do: ${outPath}`);
}

void runBenchmark();