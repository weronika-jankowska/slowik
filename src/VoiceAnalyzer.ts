import { PitchDetector } from 'pitchy';

export class RealtimeVoiceAnalyzer {
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  private detector: PitchDetector<Float32Array> | null = null;

  private pitchBuffer: number[] = [];
  private amplitudeBuffer: number[] = [];
  private timeBuffer: number[] = [];

  public async initMicrophone(): Promise<boolean> {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      this.analyserNode = this.audioCtx.createAnalyser();
      // 4096 próbek pod pełną zgodność z FFT Omori et al. (1996) dla SPR
      this.analyserNode.fftSize = 4096;
      this.analyserNode.smoothingTimeConstant = 0.3;

      // Detektor pitchy inicjalizujemy na 2048 próbek pod kątem optymalizacji wydajności w czasie rzeczywistym
      this.detector = PitchDetector.forFloat32Array(2048);

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false
        }
      });

      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      source.connect(this.analyserNode);

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      return true;
    } catch (err) {
      console.error("Brak dostępu do mikrofonu:", err);
      return false;
    }
  }

  public processFrame(): { pitch: number; rms: number } {
    if (!this.analyserNode || !this.audioCtx || !this.detector) return { pitch: 0, rms: 0 };

    const buffer = new Float32Array(this.analyserNode.fftSize);
    this.analyserNode.getFloatTimeDomainData(buffer);

    // RMS liczony z całego bufora
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      const val = buffer[i] ?? 0;
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);

    if (rms < 0.01) return { pitch: 0, rms };

    // Optymalizacja: detekcja wysokości tonu na pierwszych 2048 próbkach (niska latencja, brak spadków klatek)
    const [pitch, clarity] = this.detector.findPitch(buffer.subarray(0, 2048), this.audioCtx.sampleRate);

    if (clarity > 0.8 && pitch > 50 && pitch < 1200) {
      const now = this.audioCtx.currentTime;
      this.pitchBuffer.push(pitch);
      this.amplitudeBuffer.push(rms);
      this.timeBuffer.push(now);
      return { pitch: Number(pitch.toFixed(1)), rms: Number(rms.toFixed(3)) };
    }

    return { pitch: 0, rms };
  }

  public getCollectedPitchCount(): number {
    return this.pitchBuffer.length;
  }

  public getPitchHistory(): number[] {
    return [...this.pitchBuffer];
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  public stop(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
    }
  }
}