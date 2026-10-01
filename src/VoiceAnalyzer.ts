import { PitchDetector } from 'pitchy';
import type { VoiceMetrics } from './types';

export class RealtimeVoiceAnalyzer {
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;

  private pitchBuffer: number[] = [];
  private amplitudeBuffer: number[] = [];
  private timeBuffer: number[] = [];

  public async initMicrophone(): Promise<boolean> {
    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 2048;

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false
        }
      });

      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      source.connect(this.analyserNode);
      return true;
    } catch (err) {
      console.error("Brak dostępu do mikrofonu:", err);
      return false;
    }
  }

  public processFrame(): { pitch: number; rms: number } {
    if (!this.analyserNode || !this.audioCtx) return { pitch: 0, rms: 0 };

    const buffer = new Float32Array(this.analyserNode.fftSize);
    this.analyserNode.getFloatTimeDomainData(buffer);

    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);

    if (rms < 0.01) return { pitch: 0, rms };

    const detector = PitchDetector.forFloat32Array(buffer.length);
    const [pitch, clarity] = detector.findPitch(buffer, this.audioCtx.sampleRate);

    if (clarity > 0.8 && pitch > 50 && pitch < 1200) {
      const now = this.audioCtx.currentTime;
      this.pitchBuffer.push(pitch);
      this.amplitudeBuffer.push(rms);
      this.timeBuffer.push(now);
      return { pitch: Number(pitch.toFixed(1)), rms: Number(rms.toFixed(3)) };
    }

    return { pitch: 0, rms };
  }

  // Metoda przygotowana pod przeliczenie metryk na koniec etapu
  public getCollectedPitchCount(): number {
    return this.pitchBuffer.length;
  }

  public stop(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }
}