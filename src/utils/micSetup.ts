// Ustawienia mikrofonu

import { audioDebug } from './pianoSampler';

/** Ograniczenia dla getUserMedia */
export const RAW_MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    voiceIsolation: false
  } as MediaTrackConstraints
};

type Processing = { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean; voiceIsolation?: boolean };

const processingOf = (track: MediaStreamTrack): Processing => {
  const s = track.getSettings() as MediaTrackSettings & Processing;
  return { echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl, voiceIsolation: s.voiceIsolation };
};

/** Sprawdza, czy przetwarzanie sygnału jest wyłączone */
export async function ensureRawMic(stream: MediaStream): Promise<Processing> {
  const track = stream.getAudioTracks()[0];
  if (!track) return {};
  let p = processingOf(track);
  audioDebug('mic settings', { label: track.label, ...p, sampleRate: track.getSettings().sampleRate });
  if (p.echoCancellation || p.noiseSuppression || p.autoGainControl || p.voiceIsolation) {
    try {
      await track.applyConstraints(RAW_MIC_CONSTRAINTS.audio);
    } catch (e) {
      audioDebug('mic applyConstraints failed', { err: String(e) });
    }
    p = processingOf(track);
    audioDebug('mic settings after fix', { ...p });
  }
  return p;
}
