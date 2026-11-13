import { useEffect, useRef, type RefObject } from 'react';
import film from './assets/bg-vid.mp4';
import filmPoster from './assets/bg-vid-poster.jpg';
import './silk.css';

export function SilkFilm({
  active = true,
  className,
  startAt = 0,
  variant = 'default',
  videoRef,
  followRef,
}: {
  active?: boolean;
  className?: string;
  startAt?: number;
  /** p3 uses a vertically flipped copy of the background film. */
  variant?: 'default' | 'mirror';
  /** Expose the underlying video for cross-film sync. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** Keep this film locked to another film's clock. */
  followRef?: RefObject<HTMLVideoElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    const node = filmRef.current;
    if (!wrap || !node) return;
    if (videoRef) videoRef.current = node;
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
      if (videoRef && videoRef.current === node) videoRef.current = null;
      node.removeEventListener('loadedmetadata', seek);
      node.removeEventListener('loadeddata', kick);
      node.removeEventListener('canplay', kick);
      observer.disconnect();
      if (!node.paused) node.pause();
    };
  }, [active, startAt, videoRef]);

  useEffect(() => {
    if (!followRef) return;
    const node = filmRef.current;
    if (!node) return;
    let frame = 0;
    const lock = () => {
      frame = 0;
      const leader = followRef.current;
      if (!leader || !Number.isFinite(leader.currentTime)) return;
      if (Math.abs(node.currentTime - leader.currentTime) > 0.04) {
        try {
          node.currentTime = leader.currentTime;
        } catch {
          /* ignore seek race while metadata loads */
        }
      }
      if (leader.paused) {
        if (!node.paused) node.pause();
      } else if (node.paused && active && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const play = node.play();
        if (play && typeof play.catch === 'function') play.catch(() => undefined);
      }
    };
    const onFrame = () => {
      lock();
      frame = window.requestAnimationFrame(onFrame);
    };
    frame = window.requestAnimationFrame(onFrame);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, followRef]);

  return (
    <div
      ref={wrapRef}
      className={['gk-silk', variant === 'mirror' ? 'gk-silk--mirror' : '', className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <video
        ref={filmRef}
        className="gk-silk__film"
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        poster={filmPoster}
      >
        <source src={film} type="video/mp4" />
      </video>
    </div>
  );
}
