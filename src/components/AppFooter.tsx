/** Stopka z autorami – na dole strony, pod treścią */
export default function AppFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`w-full shrink-0 px-4 sm:px-6 pt-3 pb-2 text-right font-cardo text-white/90 text-[10px] sm:text-[11px] leading-snug select-none ${className}`}>
      autorzy: Weronika Jankowska, dr inż. Agnieszka Paula Pietrzak
      <br />
      Zakład Elektroakustyki, Politechnika Warszawska
    </footer>
  );
}
