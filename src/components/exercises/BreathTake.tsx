import { useEffect, useRef } from 'react';
import PitchPlot from './PitchPlot';
import { LegendItem, MicProblem, PlotCard, StatusRow } from './exerciseUi';
import { useTake, type TakeFrame } from '../../hooks/useTake';
import { formatDecimalPl, getCalibratedMidiFreq, midiToNoteName } from '../../utils/noteUtils';
import { measureBreathFrame, summarizeBreath, type BreathFrame, type BreathSummary } from '../../utils/breathiness';

// Jedno nagranie [A] z pomiarem powietrza w głosie

/** Co która dźwięczna ramka liczyć miary (jak w analizie głosu) */
const EVERY_NTH = 4;
const MIN_RMS = 0.015;
const BAND_CENTS = 50;

const makeBuffer = (n: number) => new Float32Array(n);

interface BreathTakeProps {
  durationSec: number;
  referenceMidi: number;
  onDone: (r: BreathSummary) => void;
  onCancel: () => void;
}

export default function BreathTake({ durationSec, referenceMidi, onDone, onCancel }: BreathTakeProps) {
  const take = useTake();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const frames: BreathFrame[] = [];
    let voiced = 0;
    let buf: ReturnType<typeof makeBuffer> | null = null;
    const onFrame = (f: TakeFrame, analyser: AnalyserNode | null) => {
      if (!analyser || f.f0 === null || f.rms < MIN_RMS) return;
      voiced++;
      if (voiced % EVERY_NTH !== 0) return;
      if (!buf || buf.length !== analyser.fftSize) buf = makeBuffer(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      frames.push(measureBreathFrame(buf, analyser.context.sampleRate, f.f0, f.t));
    };
    void take.run({
      maxSec: durationSec,
      referenceMidi,
      targetHz: getCalibratedMidiFreq(referenceMidi),
      onFrame,
      onDone: () => doneRef.current(summarizeBreath(frames))
    });
    return () => take.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = take.live;
  const inBand = live !== null && Number.isFinite(live.cents) && Math.abs(live.cents) <= BAND_CENTS;
  return (
    <>
      <PlotCard
        countdown={take.phase === 'countdown' ? take.countdown : null}
        plot={<PitchPlot dataRef={take.plotRef} durationSec={durationSec} bandCents={BAND_CENTS} rangeCents={150} targetLabel={midiToNoteName(referenceMidi)} running={take.phase === 'recording'} />}
        legend={<LegendItem swatch="w-4 h-3 bg-emerald-400/40">dźwięk wzorcowy ±{BAND_CENTS} centów</LegendItem>}
      >
        {take.phase === 'recording' && (
          <StatusRow
            left={{ label: 'Czas', value: `${formatDecimalPl(take.started ? take.elapsed : 0, 1)} / ${durationSec} s` }}
            center={!take.started ? <>Zaśpiewaj <i className="normal-case">a</i></> : <>Śpiewaj równe <i className="normal-case">a</i></>}
            centerSub={!take.started ? undefined : inBand ? 'na dźwięku wzorcowym' : 'wróć do dźwięku wzorcowego'}
            centerClass={inBand || !take.started ? 'text-emerald-300' : 'text-white/80'}
            right={{ label: 'Twój głos', value: live?.f0 ? `${formatDecimalPl(live.f0, 1)} Hz` : '--- Hz' }}
            progress={take.elapsed / durationSec}
            button={{ label: 'Anuluj', onClick: () => { take.cancel(); onCancel(); } }}
          />
        )}
      </PlotCard>
      <MicProblem state={take.micState} />
    </>
  );
}
