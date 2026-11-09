import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SIGNUP_ACTIVITIES } from '../../../shared/activities';
import ball from './assets/ball.png';
import dumbbells from './assets/dumbbells.png';
import grain from './assets/grain.jpg';
import grid from './assets/grid.jpg';
import orb from './assets/orb.png';
import queen from './assets/queen.png';
import star from './assets/star.png';
import stripes from './assets/stripes.png';
import './site.css';

const ACTIVITIES = SIGNUP_ACTIVITIES;

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
    <section ref={ref} id="activities" className={`gka${inView ? ' is-in' : ''}`} style={{ backgroundImage: `url(${grain})` }}>
      <div className="gka-stripes" style={{ backgroundImage: `url(${stripes})` }} />
      <div className="gka-bar" />
      <img className="gka-queen" src={queen} alt="" />
      <img className="gka-ball" src={ball} alt="" />
      <h2 className="gka-title">ACTIVITIES</h2>
      <img className="gka-dumbbells" src={dumbbells} alt="" />
      <ul className="gka-list">
        {ACTIVITIES.map((name, index) => (
          <li key={name} style={{ ['--i' as string]: index }}>{name.toUpperCase()}</li>
        ))}
      </ul>
    </section>
  );
}

function Register() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} id="register" className={`gkr${inView ? ' is-in' : ''}`} style={{ backgroundImage: `url(${grain})` }}>
      <div className="gkr-stripes" style={{ backgroundImage: `url(${stripes})` }} />
      <div className="gkr-bar" />
      <h2 className="gkr-title" aria-hidden="true">GYMKHANA</h2>
      <p className="gkr-sector">SECTOR 19</p>
      <img className="gkr-star" src={star} alt="" />
      <Link className="gkr-cta" to="/register">REGISTER<br />NOW</Link>
      <a className="gkr-phone" href="tel:+911010100001">+91 10101 00001</a>
      <a className="gkr-mail" href="mailto:Contact@gymkhana.com">Contact@gymkhana.com</a>
    </section>
  );
}

export function SiteHome() {
  const scrollerRef = useRef<HTMLElement>(null);
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
      const hero = root.querySelector('.gkh');
      const range = hero instanceof HTMLElement
        ? Math.max(1, hero.offsetHeight)
        : root.clientHeight;
      const next = Math.min(1, Math.max(0, root.scrollTop / range));
      const register = root.querySelector('.gkr');
      let reg = 0;
      if (register instanceof HTMLElement) {
        const start = register.offsetTop - root.clientHeight;
        const span = Math.max(1, register.offsetHeight);
        reg = Math.min(1, Math.max(0, (root.scrollTop - start) / span));
      }
      root.style.setProperty('--hero', next.toFixed(4));
      root.style.setProperty('--reg', reg.toFixed(4));
      root.classList.toggle('is-docked', next >= 0.92 && reg < 0.08);
      root.classList.toggle('is-away', next >= 0.5);
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
      <svg className="gks-defs" aria-hidden="true">
        <defs>
          <clipPath id="gk-wave-clip" clipPathUnits="objectBoundingBox">
            <path d="M0,-1 L0,2 L0.9,2 C0.88,1.979,0.86,1.958,0.852,1.938 C0.845,1.917,0.849,1.896,0.858,1.875 C0.867,1.854,0.881,1.833,0.888,1.813 C0.896,1.792,0.898,1.771,0.9,1.75 C0.902,1.729,0.904,1.708,0.912,1.688 C0.919,1.667,0.933,1.646,0.942,1.625 C0.951,1.604,0.955,1.583,0.948,1.563 C0.94,1.542,0.92,1.521,0.9,1.5 C0.88,1.479,0.86,1.458,0.852,1.438 C0.845,1.417,0.849,1.396,0.858,1.375 C0.867,1.354,0.881,1.333,0.888,1.313 C0.896,1.292,0.898,1.271,0.9,1.25 C0.902,1.229,0.904,1.208,0.912,1.188 C0.919,1.167,0.933,1.146,0.942,1.125 C0.951,1.104,0.955,1.083,0.948,1.063 C0.94,1.042,0.92,1.021,0.9,1 C0.88,0.979,0.86,0.958,0.852,0.938 C0.845,0.917,0.849,0.896,0.858,0.875 C0.867,0.854,0.881,0.833,0.888,0.813 C0.896,0.792,0.898,0.771,0.9,0.75 C0.902,0.729,0.904,0.708,0.912,0.688 C0.919,0.667,0.933,0.646,0.942,0.625 C0.951,0.604,0.955,0.583,0.948,0.563 C0.94,0.542,0.92,0.521,0.9,0.5 C0.88,0.479,0.86,0.458,0.852,0.438 C0.845,0.417,0.849,0.396,0.858,0.375 C0.867,0.354,0.881,0.333,0.888,0.313 C0.896,0.292,0.898,0.271,0.9,0.25 C0.902,0.229,0.904,0.208,0.912,0.188 C0.919,0.167,0.933,0.146,0.942,0.125 C0.951,0.104,0.955,0.083,0.948,0.063 C0.94,0.042,0.92,0.021,0.9,0 C0.88,-0.021,0.86,-0.042,0.852,-0.062 C0.845,-0.083,0.849,-0.104,0.858,-0.125 C0.867,-0.146,0.881,-0.167,0.888,-0.187 C0.896,-0.208,0.898,-0.229,0.9,-0.25 C0.902,-0.271,0.904,-0.292,0.912,-0.312 C0.919,-0.333,0.933,-0.354,0.942,-0.375 C0.951,-0.396,0.955,-0.417,0.948,-0.437 C0.94,-0.458,0.92,-0.479,0.9,-0.5 C0.88,-0.521,0.86,-0.542,0.852,-0.562 C0.845,-0.583,0.849,-0.604,0.858,-0.625 C0.867,-0.646,0.881,-0.667,0.888,-0.687 C0.896,-0.708,0.898,-0.729,0.9,-0.75 C0.902,-0.771,0.904,-0.792,0.912,-0.812 C0.919,-0.833,0.933,-0.854,0.942,-0.875 C0.951,-0.896,0.955,-0.917,0.948,-0.937 C0.94,-0.958,0.92,-0.979,0.9,-1 Z">
              <animateTransform
                attributeName="transform"
                type="translate"
                from="0 0"
                to="0 0.5"
                dur="10s"
                repeatCount="indefinite"
              />
            </path>
          </clipPath>
          <filter id="gk-bend" x="-22%" y="-35%" width="155%" height="170%" colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.002 0.038" numOctaves="2" seed="2" stitchTiles="stitch" result="slow" />
            <feColorMatrix in="slow" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0" result="slowX" />
            <feOffset in="slowX" dx="0" dy="0" result="slowF">
              <animate attributeName="dy" values="0;180" dur="13s" repeatCount="indefinite" />
            </feOffset>
            <feTurbulence type="turbulence" baseFrequency="0.008 0.07" numOctaves="1" seed="11" stitchTiles="stitch" result="fast" />
            <feColorMatrix in="fast" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0" result="fastX" />
            <feOffset in="fastX" dx="0" dy="0" result="fastF">
              <animate attributeName="dy" values="0;110" dur="6.2s" repeatCount="indefinite" />
            </feOffset>
            <feComposite in="slowF" in2="fastF" operator="arithmetic" k1="0" k2="0.72" k3="0.28" k4="0" result="mix" />
            <feGaussianBlur in="mix" stdDeviation="1.6" result="soft" />
            <feDisplacementMap in="SourceGraphic" in2="soft" scale="12" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
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
      <Activities />
      <Register />
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
