import { useId, type ReactNode } from 'react';
import './exercises.css';

export type ExerciseIconName =
  | 'breath' | 'vibrato' | 'stability' | 'range' | 'formant' | 'trill'
  | 'voicing' | 'vibratoOnDemand' | 'chord' | 'timbre' | 'intervals' | 'messa' | 'phrase' | 'longTone' | 'air' | 'warmup';

/** Fala sinusoidalna z krzywych Béziera */
function sinePath(y: number, amp: number, fromX: number, periods: number): string {
  const p = 24;
  let d = `M${fromX} ${y} Q${fromX + p / 4} ${y - amp * 2} ${fromX + p / 2} ${y}`;
  for (let i = 1; i < periods * 2; i++) d += ` T${fromX + (p / 2) * (i + 1)} ${y}`;
  return d;
}

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#4a6fe0" />
        <stop offset="1" stopColor="#a56be0" />
      </linearGradient>
      <linearGradient id={`${id}-warm`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ff7ac6" />
        <stop offset="1" stopColor="#ffb27a" />
      </linearGradient>
      <radialGradient id={`${id}-orb`} cx="40%" cy="35%" r="70%">
        <stop offset="0" stopColor="#ffc2ea" />
        <stop offset=".55" stopColor="#ff8fcf" />
        <stop offset="1" stopColor="#ffb27a" />
      </radialGradient>
      <radialGradient id={`${id}-halo`}>
        <stop offset="0" stopColor="#ffa6dc" stopOpacity=".9" />
        <stop offset="1" stopColor="#ffa6dc" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset=".22" stopColor="#fff" stopOpacity="1" />
        <stop offset=".78" stopColor="#fff" stopOpacity="1" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect x="0" y="0" width="64" height="64" fill={`url(#${id}-fade)`} />
      </mask>
    </defs>
  );
}

const STROKE = { fill: 'none', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function ExerciseIcon({ name, className }: { name: ExerciseIconName; className?: string }) {
  const id = useId().replace(/:/g, '');
  const grad = `url(#${id}-g)`;
  const warm = `url(#${id}-warm)`;
  const mask = `url(#${id}-mask)`;

  let body: ReactNode;
  switch (name) {
    case 'breath':
      body = (
        <>
          <circle className="ex-breath-halo" cx="32" cy="32" r="30" fill={`url(#${id}-halo)`} />
          <circle className="ex-breath-orb" cx="32" cy="32" r="21" fill={`url(#${id}-orb)`} />
        </>
      );
      break;
    case 'vibrato':
      body = (
        <g mask={mask}>
          <g className="ex-wave-run"><path d={sinePath(32, 5, -24, 5)} stroke={grad} {...STROKE} /></g>
        </g>
      );
      break;
    case 'stability':
      body = (
        <>
          <path className="ex-line-draw" pathLength={1} d="M8 32 H56" stroke={grad} {...STROKE} />
          <circle className="ex-line-head" cx="32" cy="32" r="3.6" fill={warm} />
        </>
      );
      break;
    case 'range':
      body = (
        <>
          <path d="M10 50 C22 48 28 34 34 28 S48 16 54 12" stroke={grad} strokeOpacity=".35" {...STROKE} strokeWidth={1.6} strokeDasharray="1 5" />
          {[[12, 50], [23, 41], [34, 32], [45, 22], [54, 12]].map(([x, y], i) => (
            <circle key={i} className="ex-step-dot" style={{ animationDelay: `${i * 0.32}s` }} cx={x} cy={y} r="4" fill={i % 2 ? warm : grad} />
          ))}
        </>
      );
      break;
    case 'formant':
      body = (
        <>
          <circle className="ex-peak-glow" cx="46" cy="16" r="10" fill={`url(#${id}-halo)`} />
          <path d="M6 52 C14 52 14 30 22 30 C30 30 30 46 38 44 C42 43 42 14 47 14 C52 14 52 50 58 52" stroke={grad} {...STROKE} />
          <circle cx="47" cy="14" r="2.6" fill={warm} />
        </>
      );
      break;
    case 'trill':
      body = (
        <>
          {[10, 21, 32, 43, 54].map((x, i) => (
            <circle key={x} className="ex-trill-dot" style={{ animationDelay: `${i * 0.07}s` }} cx={x} cy="32" r={i === 2 ? 4.6 : 3.4} fill={i % 2 ? warm : grad} />
          ))}
          <path d="M10 46 Q 21 52 32 46 T 54 46" stroke={grad} strokeOpacity=".4" {...STROKE} strokeWidth={1.8} />
        </>
      );
      break;
    case 'voicing':
      body = (
        <>
          <g className="ex-mouth-rays" stroke={warm} {...STROKE} strokeWidth={2}>
            <path d="M54 22 Q 58 32 54 42" /><path d="M59 16 Q 66 32 59 48" />
          </g>
          <ellipse className="ex-mouth" cx="30" cy="32" rx="17" ry="17" fill="none" stroke={grad} strokeWidth="2.6" />
        </>
      );
      break;
    case 'vibratoOnDemand':
      body = (
        <g mask={mask}>
          <g className="ex-wave-toggle" style={{ transformOrigin: '32px 32px' }}>
            <g className="ex-wave-run"><path d={sinePath(32, 9, -24, 5)} stroke={grad} {...STROKE} /></g>
          </g>
        </g>
      );
      break;
    case 'chord':
      body = (
        <>
          <path d="M10 18 H54" stroke={grad} {...STROKE} />
          <path d="M10 46 H54" stroke={grad} {...STROKE} />
          <path className="ex-chord-slot" d="M10 32 H54" stroke={warm} {...STROKE} strokeDasharray="1 6" />
          <circle className="ex-chord-slot" cx="32" cy="32" r="4.4" fill={warm} />
        </>
      );
      break;
    case 'timbre':
      body = (
        <>
          <circle cx="25" cy="32" r="15" fill={grad} fillOpacity=".18" stroke={grad} strokeWidth="2.4" />
          <circle className="ex-blend" cx="34" cy="32" r="15" fill={warm} fillOpacity=".22" stroke={warm} strokeWidth="2.4" />
        </>
      );
      break;
    case 'intervals':
      body = (
        <>
          <path d="M14 46 Q 32 2 50 18" stroke={grad} strokeOpacity=".4" {...STROKE} strokeWidth={1.6} strokeDasharray="1 5" />
          <circle cx="14" cy="46" r="3.6" fill={grad} />
          <circle cx="50" cy="18" r="3.6" fill={grad} />
          <circle className="ex-hop" cx="0" cy="0" r="4.6" fill={warm} />
        </>
      );
      break;
    case 'messa':
      body = (
        <>
          <path d="M6 32 H58" stroke={grad} strokeOpacity=".35" {...STROKE} strokeWidth={1.6} />
          <path className="ex-swell" d="M6 32 Q32 2 58 32 Q32 62 6 32 Z" fill={grad} fillOpacity=".22" stroke={grad} strokeWidth="2.4" strokeLinejoin="round" />
        </>
      );
      break;
    case 'warmup':
      body = (
        <>
          <path d="M8 48 L32 14 L56 48" stroke={grad} strokeOpacity=".25" {...STROKE} strokeWidth={1.6} strokeDasharray="1 5" />
          {[[9, 48], [17, 37], [25, 25], [32, 15], [39, 25], [47, 37], [55, 48]].map(([x, y], i) => (
            <circle key={i} className="ex-step-dot" style={{ animationDelay: `${i * 0.28}s` }} cx={x} cy={y} r="3.6" fill={i === 3 ? warm : grad} />
          ))}
        </>
      );
      break;
    case 'longTone':
      body = (
        <>
          <circle className="ex-long-breath" cx="10" cy="32" r="5" fill={warm} />
          <path d="M18 32 H56" stroke={grad} strokeOpacity=".25" {...STROKE} />
          <path className="ex-long" pathLength={1} d="M18 32 H56" stroke={grad} {...STROKE} />
        </>
      );
      break;
    case 'air':
      body = (
        <>
          {[20, 32, 44].map((y, i) => (
            <path key={y} className="ex-air" style={{ animationDelay: `${i * 0.45}s` }} d={`M10 ${y} q 8 -5 16 0 t 16 0`} stroke={i === 1 ? warm : grad} {...STROKE} strokeWidth={2.2} />
          ))}
        </>
      );
      break;
    case 'phrase':
    default:
      // jedna wysokość, zmieniające się sylaby
      body = (
        <>
          <path d="M6 32 H58" stroke={grad} strokeOpacity=".25" {...STROKE} strokeWidth={1.6} />
          {[8, 20, 32, 44, 56].map((x, i) => (
            <rect key={x} className="ex-step-dot" style={{ animationDelay: `${i * 0.3}s` }} x={x - 4.5} y="28" width="9" height="8" rx="4" fill={i % 2 ? warm : grad} />
          ))}
        </>
      );
  }

  return (
    <svg className={`ex-icon ${className ?? ''}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <Defs id={id} />
      {body}
    </svg>
  );
}
