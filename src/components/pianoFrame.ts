import type { CSSProperties } from 'react';

// Ramka klawiatury w analizie głosu

/** Styl ramki klawiatury. */
export const PIANO_FRAME_STYLE: CSSProperties = {
  backgroundColor: 'rgba(24, 56, 143, 0.62)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  padding: 12,
  borderRadius: 6,
  border: '1px solid rgba(255, 255, 255, 0.22)',
  boxShadow: '0 12px 30px rgba(10, 20, 60, 0.35)'
};
