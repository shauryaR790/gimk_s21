import { useEffect, useRef } from 'react';
import film from './assets/bgjimk.mp4';
import filmPoster from './assets/bgjimk-poster.jpg';
import './silk.css';

export function SilkFilm({
  active = true,
  className,
  startAt = 0,
}: {
  active?: boolean;
  className?: string;
  startAt?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    const node = filmRef.current;
    if (!wrap || !node) return;
    const quiet = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seek = () => {
      if (!startAt || !node.duration || !Number.isFinite(node.duration)) return;
      if (node.currentTime < 0.08) node.currentTime = startAt % node.duration;
    };
    const sync = (on: boolean) => {
      if (on && active && !quiet()) {
        seek();
        if (node.paused) void node.play();
      } else if (!node.paused) node.pause();
    };
    node.addEventListener('loadedmetadata', seek);
    const observer = new IntersectionObserver(([entry]) => {
      sync(entry.isIntersecting);
    }, { threshold: [0, 0.06, 0.4] });
    observer.observe(wrap);
    return () => {
      node.removeEventListener('loadedmetadata', seek);
      observer.disconnect();
      if (!node.paused) node.pause();
    };
  }, [active, startAt]);
  return (
    <div
      ref={wrapRef}
      className={['gk-silk', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <video
        ref={filmRef}
        className="gk-silk__film"
        muted
        loop
        playsInline
        preload="auto"
        poster={filmPoster}
      >
        <source src={film} type="video/mp4" />
      </video>
    </div>
  );
}
