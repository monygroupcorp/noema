import { useEffect } from 'react';
import './lightbox.css';

// Shared result-image viewer (noema-048): full-viewport overlay, image at
// object-fit:contain, closes on scrim click or Escape. View-only v1 — no
// zoom/pan/gallery-nav (that's Space's job, under noema-046's fallback grid).
export function Lightbox({ src, alt = '', onClose }: { src: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prevFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="lb-back"
      role="button"
      tabIndex={0}
      aria-label="Close image viewer"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
    >
      <img className="lb-img" src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
