import { useEffect, useRef, useState, type ReactNode } from 'react';


/** Kolor nagłówka i krzyżyka oraz tekstu opisu */
const INK = '#2c49a8';
const TEXT = '#3354b8';

// ---------- Źródła ----------

const SOURCES = {
  mendes:
    'A. P. Mendes, H. B. Rothman, C. Sapienza, W. S. Brown Jr., „Effects of Vocal Training on the Acoustic Parameters of the Singing Voice”, Journal of Voice, t. 17, nr 4, 2003, s. 529–543.',
  biswas:
    'R. Biswas, Y. V. Srinivasa Murthy, S. Koolagudi, V. Swaroop G, „Objective Assessment of Pitch Accuracy in Equal-Tempered Vocal Music Using Signal Processing Approaches”, w: Advances in Interdisciplinary Engineering, Springer, 2020, s. 161–168.',
  sublett:
    'V. Sublett, „Vibrato or Nonvibrato in Solo and Choral Singing: Is There Room for Both?”, Journal of Singing, t. 65, 2009, s. 539.',
  sundberg:
    'J. Sundberg, „Acoustic and Psychoacoustic Aspects of Vocal Vibrato”, STL-QPSR, t. 35, nr 2–3, 1994, s. 45–68.',
  zwan:
    'P. Zwan, B. Kostek, „System for Automatic Singing Voice Recognition”, Journal of the Audio Engineering Society, t. 56, nr 9, 2008, s. 710–723.',
  ekholm:
    'E. Ekholm, G. C. Papagiannis, F. P. Chagnon, „Relating Objective Measurements to Expert Evaluation of Voice Quality in Western Classical Singing: Critical Perceptual Parameters”, Journal of Voice, t. 12, nr 2, 1998, s. 182–196.',
  farrus:
    'M. Farrús, J. Hernando, P. Ejarque, „Jitter and Shimmer Measurements for Speaker Recognition”, w: Proceedings of Interspeech 2007, Antwerpia, 2007, s. 778–781.',
  omori:
    'K. Omori, A. Kacker, L. M. Carroll, W. D. Riley, S. M. Blaugrund, „Singing Power Ratio: Quantitative Evaluation of Singing Voice Quality”, Journal of Voice, t. 10, nr 3, 1996, s. 228–235.',
  hillenbrand94:
    'J. Hillenbrand, R. A. Cleveland, R. L. Erickson, „Acoustic Correlates of Breathy Vocal Quality”, Journal of Speech and Hearing Research, t. 37, nr 4, 1994, s. 769–778.',
  hillenbrand96:
    'J. Hillenbrand, R. A. Houde, „Acoustic Correlates of Breathy Vocal Quality: Dysphonic Voices and Continuous Speech”, Journal of Speech and Hearing Research, t. 39, nr 2, 1996, s. 311–321.',
  sahinOrhon:
    'E. Şahin Orhon, T. Malkoç, „The Effects of Yawn-Sigh, Lip Trill and Tongue Relaxation Exercises on Frequency and Amplitude Perturbation of Voice in Vocal Training”, Cypriot Journal of Educational Sciences, t. 17, nr 1, 2022, s. 1–17.',
  ncvs:
    'National Center for Voice and Speech, „The Singer’s Formant”, https://ncvs.org/tutorials/the-singers-formant/ (dostęp: 06.11.2026).'
} as const;
export type SourceKey = keyof typeof SOURCES;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // starsze przeglądarki / brak uprawnień
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Indeks górny z odwołaniem do źródła. */
/** Odnośnik do źródła */
export function Cite({ n, source }: { n: number; source: SourceKey }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const text = SOURCES[source];

  const onClick = async () => {
    const ok = await copyText(text);
    setCopied(ok);
    setHover(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <sup>
        <button
          type="button"
          onClick={() => void onClick()}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => { setHover(false); setCopied(false); }}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          aria-label={`Źródło ${n}: ${text}. Kliknij, aby skopiować.`}
          style={{ padding: '0 2px', lineHeight: 1, fontSize: '0.85em', fontWeight: 600, color: INK, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}
        >
          {n}
        </button>
      </sup>
      {hover && (
        <span
          role="tooltip"
          className="font-cardo shadow-lg"
          style={{
            position: 'absolute', zIndex: 20, left: '50%', bottom: '100%', transform: 'translateX(-50%)', marginBottom: 6,
            width: 'min(320px, 70vw)', borderRadius: 8, background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(70,108,210,0.25)',
            padding: '8px 12px', textAlign: 'left', fontSize: 12.5, lineHeight: 1.35, color: '#18388f', pointerEvents: 'none', whiteSpace: 'normal'
          }}
        >
          {text}
          <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: '#466cd2' }}>
            {copied ? '✓ Skopiowano do schowka' : 'Kliknij, aby skopiować nazwę źródła'}
          </span>
        </span>
      )}
    </span>
  );
}

// ---------- Rysunki ----------

function F0() {
  return <><i>f</i><sub>0</sub></>;
}

function VibratoFigure({ kind }: { kind: 'rate' | 'extent' }) {
  const W = 560, H = 250, PW = 164, GAP = 22, L = 28, T = 10, B = 42;
  const colors = ['#7fb3d9', '#3a78c2', '#1d3f80'];
  const cycles = kind === 'rate' ? [2, 3, 4] : [3, 3, 3];
  const amps = kind === 'rate' ? [0.55, 0.55, 0.55] : [0.22, 0.5, 0.82];
  const plotH = H - T - B, mid = T + plotH / 2;
  const ink = '#2c49a8', grid = '#9aa8c8';
  const label = kind === 'rate'
    ? 'Trzy wykresy wysokości dźwięku w czasie: od najwolniejszego do najszybszego wibrato'
    : 'Trzy wykresy wysokości dźwięku w czasie: od najpłytszego do najgłębszego wibrato';
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 600, height: 'auto', background: '#fff', borderRadius: 2 }} role="img" aria-label={label}>
        <defs>
          <marker id={`arr-${kind}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 Z" fill={ink} />
          </marker>
        </defs>
        {[0, 1, 2].map((k) => {
          const x0 = 8 + k * (PW + GAP) + L, x1 = 8 + k * (PW + GAP) + PW;
          const n = 120, a = (amps[k] as number) * (plotH / 2 - 6);
          const pts = Array.from({ length: n + 1 }, (_, i) => {
            const u = i / n;
            return `${(x0 + u * (x1 - x0 - 4)).toFixed(1)},${(mid - a * Math.sin(2 * Math.PI * (cycles[k] as number) * u)).toFixed(1)}`;
          });
          return (
            <g key={k}>
              <line x1={x0} x2={x1 - 4} y1={mid} y2={mid} stroke={grid} strokeWidth="1" strokeDasharray="5 4" />
              <line x1={x0} x2={x0} y1={H - B} y2={T} stroke={ink} strokeWidth="1.2" markerEnd={`url(#arr-${kind})`} />
              <line x1={x0} x2={x1} y1={H - B} y2={H - B} stroke={ink} strokeWidth="1.2" markerEnd={`url(#arr-${kind})`} />
              <polyline points={pts.join(' ')} fill="none" stroke={colors[k]} strokeWidth="2.4" strokeLinejoin="round" />
              <text x={x0 - 5} y={mid + 6} textAnchor="end" fontSize="19" fontStyle="italic" fill={ink} fontFamily="Georgia, serif">
                f<tspan fontSize="13" dy="4">0</tspan>
              </text>
              <text x={(x0 + x1) / 2} y={H - 12} textAnchor="middle" fontSize="17" fill={ink} fontFamily="Georgia, serif">Czas [s]</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Schemat do opisu miary */
function FormantFigure() {
  const W = 480, H = 280, L = 60, R = 14, T = 14, B = 46;
  const x = (khz: number) => L + (khz / 5) * (W - L - R);
  const y = (db: number) => T + (-db / 45) * (H - T - B);
  const path = (pts: [number, number][]) => {
    // gładka krzywa przez punkty (Catmull-Rom → Bézier)
    const p = pts.map(([k, d]) => [x(k), y(d)] as [number, number]);
    let d = `M${p[0]![0]},${p[0]![1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] ?? p[i]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[i + 2] ?? p2;
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
    }
    return d;
  };
  const orchestra: [number, number][] = [[0, -8], [0.45, -1], [1, -9], [2, -15], [3, -22], [4, -27], [5, -32]];
  const singer: [number, number][] = [[0, -12], [0.5, -1], [1, -9], [1.8, -14], [2.7, -6], [3.2, -11], [3.7, -26], [4.5, -31]];
  const ink = '#2c49a8';
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 560, height: 'auto', background: '#fff', borderRadius: 2 }} role="img" aria-label="Schemat widma: orkiestra oraz orkiestra ze śpiewakiem; wzmocnienie głosu w zakresie 2–4 kHz">
        <rect x={x(2)} y={T} width={x(4) - x(2)} height={H - T - B} fill="#466cd2" opacity="0.08" />
        <text x={(x(2) + x(4)) / 2} y={T + 18} textAnchor="middle" fontSize="15" fill="#466cd2" fontFamily="serif">formant śpiewaczy</text>
        {[0, -10, -20, -30, -40].map((d) => (
          <g key={d}>
            <line x1={L - 4} x2={L} y1={y(d)} y2={y(d)} stroke={ink} strokeWidth="1" />
            <text x={L - 7} y={y(d) + 3.5} textAnchor="end" fontSize="13" fill={ink} fontFamily="serif">{d}</text>
          </g>
        ))}
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <g key={k}>
            <line x1={x(k)} x2={x(k)} y1={H - B} y2={H - B + 4} stroke={ink} strokeWidth="1" />
            <text x={x(k)} y={H - B + 18} textAnchor="middle" fontSize="13" fill={ink} fontFamily="serif">{k}</text>
          </g>
        ))}
        <line x1={L} x2={L} y1={T} y2={H - B} stroke={ink} strokeWidth="1" />
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={ink} strokeWidth="1" />
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="15" fill={ink} fontFamily="serif">Częstotliwość [kHz]</text>
        <text transform={`translate(16 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="15" fill={ink} fontFamily="serif">Poziom widma [dB]</text>
        <path d={path(orchestra)} fill="none" stroke="#7fb3d9" strokeWidth="2" />
        <path d={path(singer)} fill="none" stroke="#18388f" strokeWidth="2" strokeDasharray="6 4" />
        <g fontSize="14" fill={ink} fontFamily="serif">
          <line x1={x(3.05)} x2={x(3.05) + 24} y1={T + 38} y2={T + 38} stroke="#7fb3d9" strokeWidth="2" />
          <text x={x(3.05) + 30} y={T + 42.5}>orkiestra</text>
          <line x1={x(3.05)} x2={x(3.05) + 24} y1={T + 58} y2={T + 58} stroke="#18388f" strokeWidth="2" strokeDasharray="6 4" />
          <text x={x(3.05) + 30} y={T + 62.5}>orkiestra + śpiew</text>
        </g>
      </svg>
    </div>
  );
}

// ---------- Treść ----------

interface ParamInfo {
  title: string;
  /** Źródła w kolejności numeracji w tym oknie. */
  sources: SourceKey[];
  body: (c: (k: SourceKey) => ReactNode) => ReactNode;
}

const P = ({ children }: { children: ReactNode }) => <p style={{ margin: 0 }}>{children}</p>;

const INFO: Record<string, ParamInfo> = {
  mpfr: {
    title: 'Skala głosu (MPFR)',
    sources: ['mendes'],
    body: (c) => (
      <>
        <P>
          MPFR (ang. <i>Maximum Phonational Frequency Range</i>) to zakres częstotliwości Twojego głosu – od najniższego
          do najwyższego dźwięku, jaki potrafisz zaśpiewać. Aplikacja wyznacza go, mierząc częstotliwość podstawową
          kolejno śpiewanych przez Ciebie dźwięków. Zakres obejmuje zarówno dźwięki śpiewane „pełnym głosem” (rejestr
          modalny), jak i falsetem (rejestr głowowy).
        </P>
        <P>
          U wytrenowanych śpiewaków MPFR jest większy: średnio 38,4 półtonu, podczas gdy u osób niewytrenowanych
          wynosi średnio 29,1 półtonu{c('mendes')}.
        </P>
        <P>
          Trening wokalny, a w szczególności ćwiczenia w zakresie najwyższych i najniższych dźwięków Twojej skali, pozwala na poszerzanie MPFR.
        </P>
      </>
    )
  },
  mae: {
    title: 'Błąd intonacji (MAE)',
    sources: ['biswas'],
    body: (c) => (
      <>
        <P>
          Błąd intonacji określa, jak bardzo wysokość śpiewanych przez Ciebie dźwięków odbiega od dźwięku wzorcowego.
          Mówiąc prościej – pokazuje, jak czysto śpiewasz. Wartość podawana jest w centach (każdy półton to 100 centów),
          dzięki czemu można dokładnie określić precyzję intonacji.
        </P>
        <P>
          Im mniejsza wartość, tym precyzyjniej trafiasz w dźwięki. Przyjmuje się, że u profesjonalnych chórzystów błąd
          intonacji wynosi około 10–15 centów, u wytrenowanych śpiewaków 15–20 centów, a u amatorów zwykle przekracza
          50 centów{c('biswas')}.
        </P>
        <P>
          Jeśli wykonałaś/eś zarówno badanie skali, jak i pomiar pojedynczego dźwięku ze środka skali, aplikacja podaje
          średni błąd ze wszystkich zaśpiewanych dźwięków – stąd skrót MAE (ang. <i>mean absolute error</i>, średni
          błąd bezwzględny).
        </P>
      </>
    )
  },
  hasVibrato: {
    title: 'Obecność wibrato',
    sources: ['sublett'],
    body: (c) => (
      <>
        <P>Wibrato to regularne falowanie wysokości głosu, które nadaje śpiewowi głębi i ciepła.</P>
        <P>
          Słuchacze zwykle odbierają wibrato pozytywnie, jednak w śpiewie chóralnym często dąży się do jego ograniczenia,
          aby głosy lepiej współbrzmiały{c('sublett')}.
        </P>
        <P>
          Jeśli śpiewałaś/eś bez wibrato celowo – świetnie. Jeśli nie, pamiętaj, że wibrato jest techniką, której można
          się nauczyć.
        </P>
      </>
    )
  },
  vibratoRate: {
    title: 'Szybkość wibrato',
    sources: ['sundberg', 'ekholm'],
    body: (c) => (
      <>
        <P>
          Wibrato polega na okresowej zmianie częstotliwości podstawowej głosu (w uproszczeniu – tego, co odbieramy jako
          wysokość dźwięku). Szybkość wibrato (ang. <i>vibrato rate</i>) określa, ile razy na sekundę Twój głos faluje
          w górę i w dół. Rysunek poniżej pokazuje, na czym polega ten parametr.
        </P>
        <VibratoFigure kind="rate" />
        <P>
          <F0 /> – częstotliwość podstawowa Twojego głosu. Wykresy są uszeregowane od najmniejszej do największej
          szybkości wibrato.
        </P>
        <P>
          U profesjonalnych śpiewaków szybkość wibrato wynosi zwykle 5–7 Hz, czyli 5–7 cykli na sekundę{c('sundberg')}<sup>,</sup>
          {c('ekholm')}. Jest ona większa, gdy śpiew ma charakter emocjonalny – w wykonaniu utworu, a nie przy pojedynczym dźwięku. Wynosi wtedy zwykle ponad 6 Hz{c('sundberg')}.
        </P>
      </>
    )
  },
  vibratoExtent: {
    title: 'Głębokość wibrato',
    sources: ['sundberg', 'ekholm'],
    body: (c) => (
      <>
        <P>
          Głębokość wibrato (ang. <i>vibrato extent</i>) określa, jak daleko częstotliwość podstawowa odchyla się
          „w górę i w dół” podczas falowania. Rysunek poniżej pokazuje, na czym polega ten parametr.
        </P>
        <VibratoFigure kind="extent" />
        <P>
          <F0 /> – częstotliwość podstawowa Twojego głosu. Wykresy są uszeregowane od najmniejszej do największej
          głębokości wibrato.
        </P>
        <P>
          W poprawnym wibrato odchylenia od częstotliwości podstawowej nie przekraczają zwykle ±1 półtonu
          {c('sundberg')}<sup>,</sup>{c('ekholm')}. U chórzystów wibrato również może występować, ale jest bardzo płytkie – średnio
          nie więcej niż 0,1 półtonu{c('sundberg')}. Warto też pamiętać, że głębokość wibrato rośnie, gdy śpiewasz
          głośniej{c('sundberg')}.
        </P>
      </>
    )
  },
  vibratoOnset: {
    title: 'Początek wibrato',
    sources: ['ekholm'],
    body: (c) => (
      <>
        <P>
          Początek wibrato (ang. <i>vibrato onset delay</i>) pokazuje, po jakim czasie od rozpoczęcia dźwięku w Twoim
          głosie pojawia się wibrato.
        </P>
        <P>
          Wartość ta powinna być mniejsza niż 0,5 s. Wibrato pojawiające się później jest gorzej oceniane przez
          słuchaczy – początek dźwięku brzmi wtedy „prosto”, a falowanie dołącza dopiero po chwili{c('ekholm')}.
        </P>
      </>
    )
  },
  sinusoidality: {
    title: 'Sinusoidalność wibrato',
    sources: ['zwan'],
    body: (c) => (
      <>
        <P>
          Sinusoidalność wibrato pokazuje, jak regularne jest falowanie Twojego głosu, czyli jak bardzo przebieg wysokości
          dźwięku przypomina równą sinusoidę – kolejne fale wibrato mają wtedy tę samą szybkość i głębokość{c('zwan')}.
          Im wyższa wartość tego parametru, tym bardziej regularne wibrato.
        </P>
        <P>
          Parametr jest liczony z samego falowania wysokości dźwięku (po odjęciu jej powolnych zmian). Wyznacza się jego
          widmo i sprawdza, jaką część całej energii zawiera najsilniejszy prążek. Wartość 1 oznacza idealną sinusoidę – całe
          falowanie ma jedną częstotliwość. Nierówne fale, zmiany szybkości i drobne wahania rozpraszają energię na inne
          częstotliwości i obniżają wynik.
        </P>
        <P>
          W badaniach nad automatyczną oceną głosu parametry wibrato, w tym jego sinusoidalność, należały do cech najlepiej
          odróżniających śpiewaków amatorów od śpiewaków wykształconych{c('zwan')}.
        </P>
      </>
    )
  },
  jitter: {
    title: 'Jitter',
    sources: ['farrus'],
    body: (c) => (
      <>
        <P>
          Podczas śpiewu struny głosowe drgają – każde ich pojedyncze otwarcie i zamknięcie to jeden cykl krtaniowy.
          Jitter określa, jak bardzo różnią się od siebie długości kolejnych cykli, czyli jak bardzo częstotliwość
          podstawowa zmienia się z cyklu na cykl{c('farrus')}. Wartość podawana jest w procentach.
        </P>
        <P>
          Są to bardzo drobne, nieświadome wahania – nie mają nic wspólnego z wibrato. Im mniejszy jitter, tym
          stabilniejsze drgania strun głosowych. Duże wartości jittera są typowe dla głosu szorstkiego lub zachrypniętego{c('farrus')}.
        </P>
      </>
    )
  },
  shimmer: {
    title: 'Shimmer',
    sources: ['farrus'],
    body: (c) => (
      <>
        <P>
          Shimmer określa, jak bardzo różni się amplituda (siła) dźwięku w kolejnych cyklach krtaniowych, czyli
          w kolejnych drganiach strun głosowych{c('farrus')}. Wartość podawana jest w decybelach.
        </P>
        <P>
          Im mniejszy shimmer, tym równiejsze drgania strun głosowych. Duże wartości shimmeru są typowe dla głosu
          szorstkiego, zachrypniętego lub z dużą ilością powietrza{c('farrus')}.
        </P>
      </>
    )
  },
  singerFormant: {
    title: 'Formant śpiewaczy',
    sources: ['ncvs', 'omori'],
    body: (c) => (
      <>
        <P>
          Aby zrozumieć, czym jest formant śpiewaczy, warto najpierw wyjaśnić, czym jest widmo dźwięku. Widmo to
          reprezentacja sygnału (tutaj – Twojego śpiewu) w dziedzinie częstotliwości. Głos ludzki nie składa się z jednej
          częstotliwości, lecz z wielu składowych. Ich układ kształtuje barwę dźwięku i pozwala odróżniać od siebie
          głoski – każda głoska ma inny układ składowych w widmie.
        </P>
        <P>
          Formant śpiewaczy to wzmocnienie składowych w zakresie 2–4 kHz (wysokie częstotliwości). Sprawia, że głos jest
          dźwięczny i wybrzmiewa na tle instrumentów. Jest szczególnie ważny u śpiewaków operowych, których głos musi być
          słyszalny bez mikrofonu.
        </P>
        <FormantFigure />
        <P>
          Rysunek poglądowy (na podstawie{c('ncvs')}): wzmocnienie widoczne w zakresie 2–4 kHz pozwala głosowi przebić się
          przez brzmienie orkiestry, która w tym zakresie jest stosunkowo cicha. Formant śpiewaczy występuje
          w różnych miejscach tego zakresu, zależnie od rodzaju głosu i wysokości dźwięku – np. u basów w zakresie
          2,3–3 kHz, a u tenorów 3–3,8 kHz{c('omori')}.
        </P>
      </>
    )
  },
  spr: {
    title: 'SPR',
    sources: ['omori'],
    body: (c) => (
      <>
        <P>
          SPR (ang. <i>Singing Power Ratio</i>) to różnica poziomów między najsilniejszą składową widma w zakresie
          2–4 kHz a najsilniejszą składową w zakresie 0–2 kHz{c('omori')}. Wartość wyrażona jest w decybelach i zwykle
          jest ujemna, ponieważ niższe składowe głosu są silniejsze od wyższych.
        </P>
        <P>
          Im wyższa wartość (bliższa zera), tym silniejsze wysokie składowe i tym bardziej dźwięczny głos – u śpiewaków
          SPR jest wyższy niż u osób niećwiczących śpiewu{c('omori')}. Parametr ten jest powiązany z formantem
          śpiewaczym, ale pozwala ocenić nie tylko to, czy Twój głos jest dźwięczny, lecz także – jak bardzo.
        </P>
      </>
    )
  },
  breath: {
    title: 'Powietrze w głosie',
    sources: ['hillenbrand94', 'hillenbrand96'],
    body: (c) => (
      <>
        <P>
          Gdy struny głosowe w czasie drgań nie domykają się całkowicie, część powietrza przechodzi przez krtań, nie
          zamieniając się w dźwięk. Do tonu dołącza wtedy szum podobny do szeptu, a głos traci dźwięczność. Odrobina
          powietrza jest naturalna – zwłaszcza w falsecie i na najwyższych dźwiękach.
        </P>
        <P>
          Ocena łączy dwie miary: CPPS, która pokazuje, jak wyraźnie w dźwięku słychać regularne drgania strun głosowych,
          i HNR – stosunek tonu do szumu. CPPS jest jedną z miar najlepiej oddających to, jak słuchacze oceniają
          zapowietrzenie głosu{c('hillenbrand94')}{c('hillenbrand96')}. Obie miary zależą od wysokości dźwięku, dlatego
          wynik jest porównywany z typowym głosem na tej samej wysokości. Ocena ma trzy poziomy: brak, umiarkowane
          i wyraźnie słyszalne powietrze.
        </P>
        <P>
          Pogłos pomieszczenia i szum tła mogą zawyżyć ocenę. Najdokładniejszy wynik daje nagranie w cichym
          pomieszczeniu, blisko mikrofonu.
        </P>
      </>
    )
  }
};

export function hasParameterInfo(id: string): boolean {
  return id in INFO;
}

export default function ParameterInfo({ id, onClose }: { id: string; onClose: () => void }) {
  const info = INFO[id];
  const [wide, setWide] = useState(() => window.innerWidth >= 960);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 960);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!info) return null;
  const cite = (k: SourceKey) => <Cite n={info.sources.indexOf(k) + 1} source={k} />;

  return (
    <div style={{ flex: '1 1 auto', minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: wide ? '40px 0' : '128px 0 24px' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="param-info-title"
        className="backdrop-blur-md shadow-lg select-text"
        style={{
          position: 'relative', width: '100%', maxWidth: 720, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.42)', border: '1px solid rgba(255,255,255,0.45)', borderRadius: 10,
          padding: '22px 30px 26px', color: INK,
          scrollbarWidth: 'thin', scrollbarColor: 'rgba(44,73,168,0.35) transparent'
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij opis"
          title="Zamknij"
          className="hover:opacity-70 transition-opacity"
          style={{ position: 'absolute', top: 18, right: 20, padding: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: INK, lineHeight: 0 }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M2 2 L20 20 M20 2 L2 20" />
          </svg>
        </button>
        <h2 id="param-info-title" className="font-seasons" style={{ margin: '0 36px 14px', fontWeight: 400, fontSize: 28, lineHeight: 1.2, textAlign: 'center', color: INK }}>
          {info.title}
        </h2>
        <div className="font-cardo" style={{ fontSize: 15.5, lineHeight: 1.38, display: 'flex', flexDirection: 'column', gap: 10, color: TEXT }}>
          {info.body(cite)}
        </div>
      </div>
    </div>
  );
}
