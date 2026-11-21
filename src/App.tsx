import { useState, useEffect, useRef, lazy, Suspense, type ComponentType } from 'react';
import VoiceAnalysis from './components/VoiceAnalysis';
import Exercises from './components/Exercises';
import { navPush, navReplace, useNavListener } from './utils/navHistory';

type View = 'home' | 'analysis' | 'history' | 'exercises' | 'lab';

// okno „Próbki głosu” (Ctrl + G)
const labLoader = import.meta.glob<{ default: ComponentType<{ onBack: () => void }> }>('./components/lab/BreathinessLab.tsx')['./components/lab/BreathinessLab.tsx'];
const BreathinessLab = labLoader ? lazy(labLoader) : null;

export default function App() {
  const [logoPosition, setLogoPosition] = useState<'center' | 'top-left'>('center');
  const [showContent, setShowContent] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<View>('home');

  useEffect(() => { navReplace({ view: 'home' }); }, []);
  useNavListener((st) => {
    const v = st.view;
    if (v === 'analysis') {
      // powrót do zakończonej analizy nie uruchamia nowego badania
      navReplace({ view: 'history' });
      setCurrentView('history');
      return;
    }
    setCurrentView(v === 'history' || v === 'exercises' || v === 'lab' ? v : 'home');
  });
  const go = (v: View) => {
    if (v === currentView) return;
    navPush({ view: v });
    setCurrentView(v);
  };

  // ukryte okno „Próbki głosu”
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isG = e.code === 'KeyG' || e.key.toLowerCase() === 'g';
      if (BreathinessLab && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && isG) {
        e.preventDefault();
        e.stopPropagation();
        goRef.current('lab');
      }
    };
    const onHash = () => {
      if (BreathinessLab && window.location.hash === '#probki') {
        history.replaceState(history.state, '', window.location.pathname);
        goRef.current('lab');
      }
    };
    // faza przechwytywania
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => {
    const timer1 = setTimeout(() => {
      setLogoPosition('top-left');
    }, 1500);

    const timer2 = setTimeout(() => {
      setShowContent(true);
    }, 2200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  // na telefonie logo w rogu nachodziło na przewijaną treść
  const [logoHidden, setLogoHidden] = useState(false);
  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement;
      const top = el ? el.scrollTop : 0;
      setLogoHidden(window.innerWidth < 640 && top > 40);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
  useEffect(() => { setLogoHidden(false); }, [currentView]);

  const handleLogoClick = () => {
    if (logoPosition === 'top-left') {
      go('home');
    }
  };

  return (
    <div 
      className="min-h-screen w-full relative flex flex-col justify-center items-center overflow-hidden bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/background.png')" }}
    >
      {/* Dynamiczne i klikalne Logo */}
      <div 
        onClick={handleLogoClick}
        className={`fixed z-50 transition-all ${showContent ? 'duration-300' : 'duration-1000'} ease-in-out flex items-center justify-center select-none ${
          logoPosition === 'center'
            ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 md:w-64'
            : 'top-6 left-6 translate-x-0 translate-y-0 w-16 md:w-20 [@media(max-height:500px)]:top-2 [@media(max-height:500px)]:left-2 [@media(max-height:500px)]:w-9 cursor-pointer hover:opacity-85'
        } ${logoHidden ? 'opacity-0 pointer-events-none' : ''}`}
        title={logoPosition === 'top-left' ? 'Powrót do menu głównego' : undefined}
      >
        <img 
          src="/logo.svg" 
          alt="Logo" 
          className="w-full h-auto object-contain drop-shadow-md pointer-events-none"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
      </div>

      {/* Widok 1: Menu Główne */}
      {currentView === 'home' && (
        <div 
          className={`flex flex-col items-center justify-center w-full max-w-2xl px-4 transition-opacity duration-700 ease-out ${
            showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <h1 className="text-4xl md:text-6xl text-white mb-10 text-center drop-shadow-sm">
            <span className="font-seasons">Witaj w aplikacji </span>
            <span className="font-seasons italic">Słowik</span>
          </h1>

          <div className="flex flex-col gap-4 w-full max-w-md">
            <button
              onClick={() => go('analysis')}
              className="font-cardo text-sm md:text-xl py-4 px-6 rounded-xl tracking-wider text-center uppercase text-[#18388f] bg-[rgba(255,255,255,0.25)] hover:bg-[rgba(125,148,222,0.55)] transition-all duration-300 active:scale-98 shadow-md backdrop-blur-xs focus:outline-none border-none cursor-pointer"
            >
              ROZPOCZNIJ ANALIZĘ GŁOSU
            </button>

            <button
              onClick={() => go('history')}
              className="font-cardo text-sm md:text-xl py-4 px-6 rounded-xl tracking-wider text-center uppercase text-[#18388f] bg-[rgba(255,255,255,0.25)] hover:bg-[rgba(125,148,222,0.55)] transition-all duration-300 active:scale-98 shadow-md backdrop-blur-xs focus:outline-none border-none cursor-pointer"
            >
              ZAPISANE WYNIKI ANALIZ
            </button>

            <button
              onClick={() => go('exercises')}
              className="font-cardo text-sm md:text-xl py-4 px-6 rounded-xl tracking-wider text-center uppercase text-[#18388f] bg-[rgba(255,255,255,0.25)] hover:bg-[rgba(125,148,222,0.55)] transition-all duration-300 active:scale-98 shadow-md backdrop-blur-xs focus:outline-none border-none cursor-pointer"
            >
              PRZEJDŹ DO ĆWICZEŃ
            </button>
          </div>
        </div>
      )}

      {/* Widok 2: Moduł Analizy Głosu (Nowe badanie) */}
      {currentView === 'analysis' && (
        <VoiceAnalysis 
          initialMode="test"
          onBack={() => go('home')} 
          onGoToExercises={() => go('exercises')} 
        />
      )}

      {/* Widok 3: Przeglądanie Archiwum Analiz */}
      {currentView === 'history' && (
        <VoiceAnalysis 
          initialMode="history"
          onBack={() => go('home')} 
          onGoToExercises={() => go('exercises')} 
        />
      )}

      {/* Widok 5: Próbki głosu (ukryte, chronione hasłem) */}
      {currentView === 'lab' && BreathinessLab && <Suspense fallback={null}><BreathinessLab onBack={() => go('home')} /></Suspense>}

      {/* Widok 4: Ćwiczenia */}
      {currentView === 'exercises' && (
        <Exercises onBack={() => go('home')} />
      )}
    </div>
  );
}