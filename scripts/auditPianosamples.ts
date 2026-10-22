import * as fs from 'node:fs';
import * as path from 'node:path';
// @ts-ignore - biblioteka audio-decode
import decode from 'audio-decode';

// Ścieżki
const SAMPLES_DIR = path.resolve(process.cwd(), 'public/piano-mp3');
const OUTPUT_CALIBRATION_JSON = path.resolve(process.cwd(), 'src/utils/pianoFrequencies.json');

// Mapowanie nazw plików z bemolami na numery MIDI
const NOTE_BASE_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'Db': 1, 'C#': 1,
  'D': 2, 'Eb': 3, 'D#': 3,
  'E': 4,
  'F': 5, 'Gb': 6, 'F#': 6,
  'G': 7, 'Ab': 8, 'G#': 8,
  'A': 9, 'Bb': 10, 'A#': 10,
  'B': 11
};

function parseNoteFilename(filename: string): { midi: number; noteName: string } | null {
  const match = filename.match(/^([A-G][b#]?)([0-8])\.mp3$/i);
  if (!match) return null;
  const [, noteName, octaveStr] = match;
  if (!noteName || !octaveStr) return null;

  const octave = parseInt(octaveStr, 10);
  const semi = NOTE_BASE_TO_SEMITONE[noteName];
  if (semi === undefined) return null;
  const midi = (octave + 1) * 12 + semi;
  return { midi, noteName: `${noteName}${octave}` };
}

function theoreticalFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function parabolicVertex(y1: number, y2: number, y3: number): { offset: number; value: number } {
  const denom = y1 - 2 * y2 + y3;
  if (Math.abs(denom) < 1e-15) return { offset: 0, value: y2 };
  const offset = Math.max(-1, Math.min(1, (0.5 * (y1 - y3)) / denom));
  return { offset, value: y2 - 0.25 * (y1 - y3) * offset };
}

// Algorytm YIN identyczny z audioMetrics.ts[cite: 2]
function pitchYIN(buffer: Float32Array, sampleRate: number, threshold = 0.15): number {
  const bufferSize = Math.floor(buffer.length / 2);
  if (bufferSize < 4) return -1;
  const yinBuffer = new Float64Array(bufferSize);

  for (let t = 0; t < bufferSize; t++) {
    let sum = 0;
    for (let i = 0; i < bufferSize; i++) {
      const delta = (buffer[i] ?? 0) - (buffer[i + t] ?? 0);
      sum += delta * delta;
    }
    yinBuffer[t] = sum;
  }

  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let t = 1; t < bufferSize; t++) {
    runningSum += yinBuffer[t] ?? 0;
    yinBuffer[t] = runningSum === 0 ? 1 : ((yinBuffer[t] ?? 0) * t) / runningSum;
  }

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

  if (tau === -1) {
    let globalMin = Infinity;
    for (let t = 2; t < bufferSize; t++) {
      const val = yinBuffer[t] ?? 1;
      if (val < globalMin) {
        globalMin = val;
        tau = t;
      }
    }
    if (globalMin > 0.5 || tau <= 0) return -1;
  }

  let betterTau = tau;
  if (tau > 0 && tau < bufferSize - 1) {
    betterTau =
      tau + parabolicVertex(yinBuffer[tau - 1] ?? 0, yinBuffer[tau] ?? 0, yinBuffer[tau + 1] ?? 0).offset;
  }

  return betterTau > 0 ? sampleRate / betterTau : -1;
}

function calculateRMS(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const val = buffer[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

function analyzeAudioBuffer(channelData: Float32Array, sampleRate: number, expectedF0: number): number | null {
  const windowSize = expectedF0 < 130 ? 8192 : 4096;
  const hopSize = 1024;
  const f0Estimates: number[] = [];

  const startOffset = Math.floor(sampleRate * 0.025);

  for (let i = startOffset; i + windowSize <= channelData.length; i += hopSize) {
    const frame = channelData.subarray(i, i + windowSize);
    const rms = calculateRMS(frame);

    if (rms < 0.005) continue;

    const f0 = pitchYIN(frame, sampleRate, 0.15);

    if (f0 >= 30 && f0 <= 4500) {
      let correctedF0 = f0;
      if (Math.abs(f0 * 2 - expectedF0) < expectedF0 * 0.08) correctedF0 = f0 * 2;
      else if (Math.abs(f0 / 2 - expectedF0) < expectedF0 * 0.08) correctedF0 = f0 / 2;

      f0Estimates.push(correctedF0);
    }
  }

  if (f0Estimates.length === 0) return null;

  f0Estimates.sort((a, b) => a - b);
  const mid = Math.floor(f0Estimates.length / 2);
  return f0Estimates.length % 2 === 1
    ? (f0Estimates[mid] ?? null)
    : (((f0Estimates[mid - 1] ?? 0) + (f0Estimates[mid] ?? 0)) / 2);
}

async function runAudit(): Promise<void> {
  console.log('--- START AUDYTU PRÓBEK PIANINA ---');

  if (!fs.existsSync(SAMPLES_DIR)) {
    console.error(`Nie znaleziono folderu z plikami: ${SAMPLES_DIR}`);
    return;
  }

  const files = fs.readdirSync(SAMPLES_DIR).filter(f => f.toLowerCase().endsWith('.mp3'));
  console.log(`Znaleziono ${files.length} plików w folderze public/piano-mp3.\n`);

  const results: Array<{
    Plik: string;
    MIDI: number;
    Nuta: string;
    'Wzór (Hz)': string;
    'Wykryto (Hz)': string;
    'Różnica (centy)': string;
    Status: string;
  }> = [];

  const frequencyMap: Record<number, number> = {};

  for (const file of files) {
    const parsed = parseNoteFilename(file);
    if (!parsed) continue;

    // Badamy klawisze wokalne od C2 (36) do C6 (84)[cite: 1]
    if (parsed.midi < 36 || parsed.midi > 84) continue;

    const filePath = path.join(SAMPLES_DIR, file);

    try {
      const fileBuffer = fs.readFileSync(filePath);
      
      // Dekodowanie pliku audio
      const audio: any = await decode(fileBuffer);
      
      // Obsługa różnych struktur zwracanych przez bibliotekę:
      let channel0: Float32Array | null = null;
      if (typeof audio.getChannelData === 'function') {
        channel0 = audio.getChannelData(0);
      } else if (Array.isArray(audio._channelData)) {
        channel0 = audio._channelData[0];
      } else if (Array.isArray(audio)) {
        channel0 = audio[0];
      } else if (audio.channelData && Array.isArray(audio.channelData)) {
        channel0 = audio.channelData[0];
      }

      const sampleRate: number = audio.sampleRate || 44100;
      const targetF0 = theoreticalFreq(parsed.midi);

      if (!channel0) {
        console.warn(`Nie udało się odczytać próbek kanału dla ${file}`);
        continue;
      }

      // Bezpieczna konwersja do Float32Array jeśli dane przyszły w innym typie
      const floatData = channel0 instanceof Float32Array ? channel0 : new Float32Array(channel0);
      const detectedF0 = analyzeAudioBuffer(floatData, sampleRate, targetF0);

      if (detectedF0 !== null) {
        const centsDiff = 1200 * Math.log2(detectedF0 / targetF0);
        frequencyMap[parsed.midi] = Math.round(detectedF0 * 100) / 100;

        results.push({
          Plik: file,
          MIDI: parsed.midi,
          Nuta: parsed.noteName,
          'Wzór (Hz)': targetF0.toFixed(2),
          'Wykryto (Hz)': detectedF0.toFixed(2),
          'Różnica (centy)': `${centsDiff > 0 ? '+' : ''}${centsDiff.toFixed(1)} c`,
          Status: Math.abs(centsDiff) <= 10 ? 'OK' : 'ODCHYŁKA'
        });
      } else {
        results.push({
          Plik: file,
          MIDI: parsed.midi,
          Nuta: parsed.noteName,
          'Wzór (Hz)': targetF0.toFixed(2),
          'Wykryto (Hz)': '—',
          'Różnica (centy)': '—',
          Status: 'BRAK ODCZYTU'
        });
      }
    } catch (err) {
      console.error(`Błąd podczas przetwarzania pliku ${file}:`, err);
    }
  }

  results.sort((a, b) => a.MIDI - b.MIDI);
  console.table(results);

  fs.writeFileSync(
    OUTPUT_CALIBRATION_JSON,
    JSON.stringify(frequencyMap, null, 2),
    'utf-8'
  );

  console.log(`\nGotowe! Zapisano mapę częstotliwości do: ${OUTPUT_CALIBRATION_JSON}`);
}

void runAudit();