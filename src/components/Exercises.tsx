import { useState } from 'react';
import { ExerciseIcon, type ExerciseIconName } from './exercises/ExerciseIcons';
import VibratoControlExercise from './exercises/VibratoControlExercise';

type ExerciseId =
  | 'prepare' | 'vibrato-control' | 'stability' | 'range' | 'formant' | 'trill'
  | 'voicing' | 'chord' | 'timbre' | 'phrase' | 'vibrato-on-demand' | 'intervals' | 'messa';

interface ExerciseTile {
  id: ExerciseId;
  title: string;
  description: string;
  icon: ExerciseIconName;
  /** Tylko to ćwiczenie jest na razie zaimplementowane. */
  available?: boolean;
}

interface ExerciseSection {
  heading?: string;
  tiles: ExerciseTile[];
}

const SECTIONS: ExerciseSection[] = [
  {
    tiles: [
      { id: 'prepare', icon: 'breath', title: 'Przygotowanie do ćwiczeń', description: 'Przygotuj się do ćwiczeń poprzez rozluźnienie i pracę nad oddechem' },
      { id: 'stability', icon: 'stability', title: 'Stabilność tonu', description: 'Ćwiczenie pozwala ćwiczyć kontrolę stabilności tonu w zakresie Twojej skali' },
      { id: 'range', icon: 'range', title: 'Poszerzanie skali', description: 'Ćwicz dźwięki na granicy swojej skali, aby zwiększyć zakres swojego głosu' },
      { id: 'formant', icon: 'formant', title: 'Formant śpiewaczy', description: 'Kontroluj dźwięczność swojego głosu, aby wybrzmiewać nad instrumentami' },
      { id: 'trill', icon: 'trill', title: 'Tryl wargowy', description: 'Powtarzaj melodię wykonując tryl. To dobre ćwiczenie na rozgrzewkę' },
      { id: 'voicing', icon: 'voicing', title: 'Dźwięczność głosu', description: 'Zacznij od „mmm” i płynnie przejdź na „aaa”, by poczuć lepsze podparcie dźwięku' }
    ]
  },
  {
    heading: 'Dla chórzystów',
    tiles: [
      { id: 'vibrato-control', icon: 'vibrato', available: true, title: 'Minimalizacja wibrato', description: 'Ćwicz utrzymywanie prostego dźwięku, aby ograniczyć wibrato w śpiewie chóralnym' },
      { id: 'chord', icon: 'chord', title: 'Dźwięk na tle akordu', description: 'Utrzymaj swoją nutę na tle nagranego akordu i uzupełnij go własnym głosem' },
      { id: 'timbre', icon: 'timbre', title: 'Dopasuj barwę', description: 'Dopasuj barwę swojego głosu do wzorca głosu Twojej sekcji' },
      { id: 'phrase', icon: 'phrase', title: 'Długa fraza', description: 'Utrzymaj wysokość dźwięku przez całą, długą frazę' }
    ]
  },
  {
    heading: 'Dla śpiewaków rozrywkowych',
    tiles: [
      { id: 'vibrato-on-demand', icon: 'vibratoOnDemand', title: 'Wibrato na żądanie', description: 'Śpiewaj na zmianę z wibrato i bez, by świadomie je włączać i wyłączać' },
      { id: 'intervals', icon: 'intervals', title: 'Trudne interwały', description: 'Ćwicz precyzję intonacji na interwałach, które sprawiają najwięcej trudności' },
      { id: 'messa', icon: 'messa', title: 'Messa di voce', description: 'Trenuj dużą dynamikę na jednej długiej nucie: od ciszy do forte i z powrotem' }
    ]
  }
];

function Tile({ tile, onOpen }: { tile: ExerciseTile; onOpen: (id: ExerciseId) => void }) {
  const base =
    'relative text-left rounded-2xl bg-white/55 backdrop-blur-md border border-white/40 shadow-md p-5 pr-24 min-h-[124px] flex flex-col justify-center transition-all duration-200';
  const content = (
    <>
      <h3 className="font-seasons font-normal uppercase text-[#18388f] text-[19px] sm:text-[21px] leading-[1.1] tracking-wide">{tile.title}</h3>
      <p className="font-cardo text-[#466cd2] text-[12.5px] sm:text-[13px] leading-snug mt-1.5">{tile.description}</p>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 w-[68px] h-[68px]">
        <ExerciseIcon name={tile.icon} />
      </div>
      {!tile.available && (
        <span className="absolute right-3 bottom-2 font-seasons text-[9px] uppercase tracking-[0.14em] text-[#466cd2]/80 bg-white/50 rounded-full px-2 py-0.5">
          wkrótce
        </span>
      )}
    </>
  );

  return tile.available ? (
    <button type="button" onClick={() => onOpen(tile.id)} className={`${base} cursor-pointer hover:bg-white/70 hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}>
      {content}
    </button>
  ) : (
    <div className={`${base} cursor-default`} aria-disabled="true">
      {content}
    </div>
  );
}

interface ExercisesProps {
  onBack?: () => void;
  initialExercise?: ExerciseId | null;
}

export default function Exercises({ initialExercise = null }: ExercisesProps) {
  const [active, setActive] = useState<ExerciseId | null>(initialExercise);

  if (active === 'vibrato-control') {
    return <VibratoControlExercise onBack={() => setActive(null)} />;
  }

  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden font-cardo text-white">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-24 sm:pt-16 pb-14 flex flex-col items-center">
        <h1 className="font-seasons font-normal uppercase text-white text-3xl sm:text-4xl md:text-[44px] tracking-[0.05em] text-center mb-7 mt-1 drop-shadow-sm">
          Ćwiczenia wokalne
        </h1>

        <div className="w-full flex flex-col gap-7">
          {SECTIONS.map((section, si) => (
            <section key={si} className="w-full">
              {section.heading && (
                <h2 className="font-seasons font-normal uppercase text-white/85 text-sm sm:text-base tracking-[0.14em] mb-3 pl-1">{section.heading}</h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {section.tiles.map((tile) => (
                  <Tile key={tile.id} tile={tile} onOpen={setActive} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}