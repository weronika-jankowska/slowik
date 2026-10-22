import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// @ts-ignore
import wav from 'node-wav';

import {
  analyzeHarmonicity,
  calculateCPPS,
  type HarmonicityOptions,
  type CPPSOptions
} from '../src/utils/audioMetrics.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIO_DIR = path.resolve(__dirname, '..', 'audio');
const OUTPUT_CSV = path.resolve(__dirname, '..', 'wyniki_hnr_cpp_ts.csv');

// Parametry MUSZĄ być identyczne jak w batch_voice_metrics.py (stałe na górze pliku Pythona).
// Praat: Sound ▸ To Harmonicity (cc)… (time step 0.005, minimum pitch 60, silence threshold 0.1, periods per window 4.5)
const HNR_OPTIONS: HarmonicityOptions = {
  method: 'cc',
  timeStep: 0.005,
  pitchFloor: 60,
  pitchCeiling: 600,
  silenceThreshold: 0.1,
  voicingThreshold: 0.45,
  periodsPerWindow: 4.5 // domyślnie Praat dla cc używa 1.0 (okno 1 okres); 4.5 = okno 75 ms
};

// Praat: To PowerCepstrogram… (60, 0.002, 5000, 50) + Get CPPS… (no, 0.02, 0.0005, 60, 600, 0.05, parabolic, 0.001, 0, Straight, Robust)
const CPPS_OPTIONS: CPPSOptions = {
  pitchFloor: 60,
  peakSearchMinHz: 60,
  peakSearchMaxHz: 600,
  maxFrequency: 5000,
  preEmphasisHz: 50,
  timeAveragingSec: 0.02,
  quefrencyAveragingSec: 0.0005,
  tiltLineStartSec: 0.001,
  robustFit: true,
  cepstrumLengthSec: 0.04 // koniec dopasowania trendu; 0.04 s najlepiej pasuje do wyników Praat (patrz audioMetrics.ts)
};

interface AudioMetricRecord {
  filename: string;
  vowel: string;
  hnr: string;
  cpp: string;
}

function extractVowel(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  const parts = base.split('_');
  if (parts.length >= 3) {
    return parts[2] ?? 'nieznana';
  }
  return 'nieznana';
}

function getWavFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getWavFiles(fullPath));
    } else if (file.toLowerCase().endsWith('.wav')) {
      results.push(fullPath);
    }
  }
  return results;
}

function processAudioFile(filePath: string): { hnr: number; cpp: number; validFrames: number } {
  const fileBuffer = fs.readFileSync(filePath);
  const decoded = wav.decode(fileBuffer);
  const sampleRate: number = decoded.sampleRate;

  const channelData: Float32Array | undefined = decoded.channelData[0];
  if (!channelData || channelData.length === 0) {
    return { hnr: NaN, cpp: NaN, validFrames: 0 };
  }

  // HNR i CPPS liczone na CAŁYM sygnale, tak jak w Praat (okna i progi względne, bez własnej pętli po ramkach).
  // Wcześniej: ramki 4096 próbek (~93 ms) + pojedynczy lag z YIN + mediana — przy vibrato zaniżało to HNR.
  const h = analyzeHarmonicity(channelData, sampleRate, HNR_OPTIONS);
  const c = calculateCPPS(channelData, sampleRate, CPPS_OPTIONS);

  return {
    hnr: Math.round(h.meanDb * 10) / 10,
    cpp: Math.round(c.cppsDb * 10) / 10,
    validFrames: h.voicedFrames
  };
}

function main(): void {
  console.log(`[START] Szukam próbek w katalogu: ${AUDIO_DIR}`);

  if (!fs.existsSync(AUDIO_DIR)) {
    console.error(`[BŁĄD] Folder nie istnieje: ${AUDIO_DIR}`);
    return;
  }

  // Naturalne sortowanie numeryczne: p1 przed p2, a p2 przed p10
  const files = getWavFiles(AUDIO_DIR).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  if (files.length === 0) {
    console.error(`[INFORMACJA] Nie znaleziono plików .wav w: ${AUDIO_DIR}`);
    return;
  }

  console.log(`Znaleziono ${files.length} plików audio. Rozpoczynam przetwarzanie...`);

  const records: AudioMetricRecord[] = [];

  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx]!;
    const filename = path.basename(file);
    const vowel = extractVowel(filename);

    try {
      const { hnr, cpp, validFrames } = processAudioFile(file);

      // Formatowanie z przecinkiem dziesiętnym pod polskiego Excela
      const hnrStr = Number.isFinite(hnr) ? hnr.toFixed(1).replace('.', ',') : '—';
      const cppStr = Number.isFinite(cpp) ? cpp.toFixed(1).replace('.', ',') : '—';

      records.push({ filename, vowel, hnr: hnrStr, cpp: cppStr });

      console.log(
        `[${idx + 1}/${files.length}] ${filename} -> HNR: ${hnrStr} dB, CPPS: ${cppStr} dB (ramki dźwięczne: ${validFrames})`
      );
    } catch (err) {
      console.error(`[${idx + 1}/${files.length}] ${filename} -> BŁĄD:`, err);
      records.push({ filename, vowel, hnr: 'BŁĄD', cpp: 'BŁĄD' });
    }
  }

  const csvHeader = 'nazwa pliku;samogłoska;HNR;CPP\n';
  const csvRows = records
    .map(r => `"${r.filename}";"${r.vowel}";"${r.hnr}";"${r.cpp}"`)
    .join('\n');

  fs.writeFileSync(OUTPUT_CSV, '\ufeff' + csvHeader + csvRows, 'utf8');

  console.log(`\n[SUKCES] Zapisano posortowane wyniki do: ${OUTPUT_CSV}`);
}

void main();