import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SIGNUP_ACTIVITIES } from '../../../shared/activities';
import film from './assets/bgjimk.mp4';
import filmPoster from './assets/bgjimk-poster.jpg';
import grid from './assets/grid.jpg';
import orb from './assets/orb.png';
import star from './assets/star.png';
import { SportMark } from './sportMarks';
import './site.css';

const ACTIVITIES = SIGNUP_ACTIVITIES;

const ACTIVITY_COPY: Record<(typeof ACTIVITIES)[number], string> = {
  Badminton: 'Morning smash sessions through late mixed doubles. Walk in or lock a slot.',
  Basketball: 'Full-court nights, half-court mornings, and open shootaround on off-league days.',
  Football: 'Floodlit five-a-side, seven-a-side, and weekend friendlies. Boots on, play.',
  Gym: 'Racks, strength floor, and trainers on site. Come for a lift or a programme.',
  Skating: 'Rink hours for learners and regulars — figure, speed, and open skate.',
  Swimming: 'Lap lanes and leisure hours. Early club, stroke coaching, evening lengths.',
  Tennis: 'Hard courts for rally, coaching, and sets. Book a court or find a partner.',
  'Table tennis': 'Club nights, spin drills, and walk-up games. Paddle up and take the end.',
};

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, inView] as const;
}

const HERO_W = 1320;
const HERO_H = 2868;
const HERO_COLS = [0, 173, 385, 563, 757, 952, 1131, HERO_W];
const HERO_ROWS = [0, 235, 472, 601, 839, 1077, 1315, 1547, 1791, 2029, 2267, 2504, 2743, HERO_H];
const HERO_CELLS = HERO_ROWS.slice(0, -1).flatMap((y, row) => {
  const nextY = HERO_ROWS[row + 1];
  return HERO_COLS.slice(0, -1).map((x, col) => ({
    left: `${(x / HERO_W) * 100}%`,
    top: `${(y / HERO_H) * 100}%`,
    width: `${((HERO_COLS[col + 1] - x) / HERO_W) * 100}%`,
    height: `${((nextY - y) / HERO_H) * 100}%`,
    delay: `-${((row * 7 + col) * 1.618 % 11).toFixed(2)}s`,
  }));
});

function Hero() {
  return (
    <section className="gkh">
      <div className="gkh-sticky">
        <div className="gkh-fit" aria-hidden="true">
          <img className="gkh-fit__photo" src={grid} alt="" />
          <div className="gkh-lights">
            {HERO_CELLS.map((cell, i) => (
              <span
                key={i}
                style={{
                  left: cell.left,
                  top: cell.top,
                  width: cell.width,
                  height: cell.height,
                  ['--d' as string]: cell.delay,
                }}
              />
            ))}
          </div>
        </div>
        <div className="gkh-stage">
          <p className="gkh-sector">SECTOR 19</p>
          <img className="gkh-star" src={star} alt="" />
        </div>
      </div>
    </section>
  );
}

function Activities() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} id="activities" className={`gka${inView ? ' is-in' : ''}`}>
      <h2 className="gka-title">ACTIVITIES</h2>
      <div className="gka-board">
        <ul className="gka-cards">
          {ACTIVITIES.map((name, index) => (
            <li key={name} className="gka-card" style={{ ['--i' as string]: index }}>
              <div className="gka-card__copy">
                <strong>{name}</strong>
                <p>{ACTIVITY_COPY[name]}</p>
              </div>
              <SportMark sport={name} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Register() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} id="register" className={`gkr${inView ? ' is-in' : ''}`}>
      <h2 className="gkr-title" aria-hidden="true">GYMKHANA</h2>
      <p className="gkr-sector">SECTOR 19</p>
      <img className="gkr-star" src={star} alt="" />
      <Link className="gkr-cta" to="/register">REGISTER NOW</Link>
      <p className="gkr-contact">
        <a className="gkr-phone" href="tel:+911010100001">+91 10101 00001</a>
        <a className="gkr-mail" href="mailto:Contact@gymkhana.com">Contact@gymkhana.com</a>
      </p>
    </section>
  );
}

export function SiteHome() {
  const scrollerRef = useRef<HTMLElement>(null);
  const filmRef = useRef<HTMLVideoElement>(null);
  const [gate, setGate] = useState(false);
  useEffect(() => {
    document.title = 'Gymkhana · Sector 19';
    document.documentElement.classList.add('gks-page');
    document.body.classList.add('gks-page');
    return () => {
      document.documentElement.classList.remove('gks-page');
      document.body.classList.remove('gks-page');
    };
  }, []);
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const origin = root.getBoundingClientRect().top;
      const yOf = (el: Element) => root.scrollTop + (el.getBoundingClientRect().top - origin);
      const hero = root.querySelector('.gkh');
      const range = hero instanceof HTMLElement
        ? Math.max(1, hero.offsetHeight)
        : root.clientHeight;
      const next = Math.min(1, Math.max(0, root.scrollTop / range));
      const register = root.querySelector('.gkr');
      let reg = 0;
      if (next >= 0.98 && register instanceof HTMLElement && register.offsetHeight >= root.clientHeight * 0.85) {
        const top = yOf(register);
        const shown = (root.scrollTop + root.clientHeight - top) / Math.max(1, register.offsetHeight);
        const t = Math.min(1, Math.max(0, shown));
        reg = t * t * (3 - 2 * t);
      }
      root.style.setProperty('--hero', next.toFixed(4));
      root.style.setProperty('--reg', reg.toFixed(4));
      root.classList.toggle('is-docked', next >= 0.92 && reg < 0.08);
      const filmNode = filmRef.current;
      if (filmNode) {
        const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (next >= 0.55 && !quiet) {
          if (filmNode.paused) void filmNode.play();
        } else if (!filmNode.paused) filmNode.pause();
      }
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    root.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  useEffect(() => {
    if (!gate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGate(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gate]);
  return (
    <main className="gks" ref={scrollerRef}>
      <header className="gks-bar">
        <h1 className="gkh-title">
          <button
            type="button"
            className="gkh-title__mark"
            onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            GYMKHANA
          </button>
        </h1>
        <button type="button" className="gkh-account" aria-label="Sign in or register" aria-haspopup="dialog" onClick={() => setGate(true)}>
          <img src={orb} alt="" />
        </button>
      </header>
      <Hero />
      <div className="gk-live">
        <video
          ref={filmRef}
          className="gk-live__film"
          muted
          loop
          playsInline
          preload="none"
          poster={filmPoster}
        >
          <source src={film} type="video/mp4" />
        </video>
        <Activities />
        <Register />
      </div>
      {gate ? (
        <div className="gkh-gate" onClick={() => setGate(false)}>
          <div
            className="gkh-gate__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gkh-gate-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p id="gkh-gate-title" className="gkh-gate__mark">GYMKHANA</p>
            <Link className="gkh-gate__choice" to="/register">REGISTER</Link>
            <p className="gkh-gate__or">or</p>
            <Link className="gkh-gate__choice" to="/login">LOGIN</Link>
            <button type="button" className="gkh-gate__close" onClick={() => setGate(false)}>Close</button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
