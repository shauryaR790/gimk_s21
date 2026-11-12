import { useEffect, useRef } from 'react';
import film from './assets/wavy.mp4';
import filmMirror from './assets/wavy-mirror.mp4';
import filmPoster from './assets/wavy-poster.jpg';
import './silk.css';

export function SilkFilm({
  active = true,
  className,
  startAt = 0,
  variant = 'default',
}: {
  active?: boolean;
  className?: string;
  startAt?: number;
  /** p3 uses a baked vertically flipped copy of the silk film. */
  variant?: 'default' | 'mirror';
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLVideoElement>(null);
  const src = variant === 'mirror' ? filmMirror : film;
  useEffect(() => {
    const wrap = wrapRef.current;
    const node = filmRef.current;
    if (!wrap || !node) return;
    const quiet = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seek = () => {
      if (!startAt || !node.duration || !Number.isFinite(node.duration)) return;
      if (node.currentTime < 0.08) node.currentTime = startAt % node.duration;
    };
    const kick = () => {
      if (quiet() || !active) return;
      seek();
      const play = node.play();
      if (play && typeof play.catch === 'function') play.catch(() => undefined);
    };
    const sync = (on: boolean) => {
      if (on && active && !quiet()) kick();
      else if (!node.paused) node.pause();
    };
    node.addEventListener('loadedmetadata', seek);
    node.addEventListener('loadeddata', kick);
    node.addEventListener('canplay', kick);
    const observer = new IntersectionObserver(([entry]) => {
      sync(entry.isIntersecting);
    }, { threshold: [0, 0.02, 0.2] });
    observer.observe(wrap);
    return () => {
      node.removeEventListener('loadedmetadata', seek);
      node.removeEventListener('loadeddata', kick);
      node.removeEventListener('canplay', kick);
      observer.disconnect();
      if (!node.paused) node.pause();
    };
  }, [active, startAt, src]);
  return (
    <div
      ref={wrapRef}
      className={['gk-silk', variant === 'mirror' ? 'gk-silk--mirror' : '', className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <video
        key={src}
        ref={filmRef}
        className="gk-silk__film"
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        poster={filmPoster}
      >
        <source src={src} type="video/mp4" />
      </video>
    </div>
  );
}
