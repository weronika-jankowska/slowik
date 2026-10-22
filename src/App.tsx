import { useState, useEffect } from 'react';
import VoiceAnalysis from './components/VoiceAnalysis';
import Exercises from './components/Exercises';

export default function App() {
  const [logoPosition, setLogoPosition] = useState<'center' | 'top-left'>('center');
  const [showContent, setShowContent] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<'home' | 'analysis' | 'history' | 'exercises'>('home');

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

  const handleLogoClick = () => {
    if (logoPosition === 'top-left') {
      setCurrentView('home');
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
        className={`fixed z-50 transition-all duration-1000 ease-in-out flex items-center justify-center select-none ${
          logoPosition === 'center'
            ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 md:w-64'
            : 'top-6 left-6 translate-x-0 translate-y-0 w-16 md:w-20 cursor-pointer hover:opacity-85'
        }`}
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
              onClick={() => setCurrentView('analysis')}
              className="font-cardo text-sm md:text-xl py-4 px-6 rounded-xl tracking-wider text-center uppercase text-[#18388f] bg-[rgba(255,255,255,0.25)] hover:bg-[rgba(125,148,222,0.55)] transition-all duration-300 active:scale-98 shadow-md backdrop-blur-xs focus:outline-none border-none cursor-pointer"
            >
              ROZPOCZNIJ ANALIZĘ GŁOSU
            </button>

            <button
              onClick={() => setCurrentView('history')}
              className="font-cardo text-sm md:text-xl py-4 px-6 rounded-xl tracking-wider text-center uppercase text-[#18388f] bg-[rgba(255,255,255,0.25)] hover:bg-[rgba(125,148,222,0.55)] transition-all duration-300 active:scale-98 shadow-md backdrop-blur-xs focus:outline-none border-none cursor-pointer"
            >
              ZAPISANE WYNIKI ANALIZ
            </button>

            <button
              onClick={() => setCurrentView('exercises')}
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
          onBack={() => setCurrentView('home')} 
          onGoToExercises={() => setCurrentView('exercises')} 
        />
      )}

      {/* Widok 3: Przeglądanie Archiwum Analiz */}
      {currentView === 'history' && (
        <VoiceAnalysis 
          initialMode="history"
          onBack={() => setCurrentView('home')} 
          onGoToExercises={() => setCurrentView('exercises')} 
        />
      )}

      {/* Widok 4: Ćwiczenia */}
      {currentView === 'exercises' && (
        <Exercises onBack={() => setCurrentView('home')} />
      )}
    </div>
  );
}