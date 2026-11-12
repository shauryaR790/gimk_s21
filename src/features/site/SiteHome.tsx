import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { readMemberPass } from '../../lib/memberPass';
import { SIGNUP_ACTIVITIES } from '../../../shared/activities';
import ball from './assets/ball.png';
import dumbbells from './assets/dumbbells.png';
import grain from './assets/grain-rect.png';
import grid from './assets/grid.jpg';
import orb from './assets/orb.png';
import queen from './assets/queen.png';
import star from './assets/star.png';
import stripes from './assets/stripes.png';
import { SilkFilm } from './silk';
import './site.css';

const ACTIVITIES = [
  'Badminton',
  'Basketball',
  'Gym',
  'Skating',
  'Swimming',
  'Tennis',
  'Table tennis',
] as const satisfies readonly (typeof SIGNUP_ACTIVITIES)[number][];

const ACTIVITY_COPY: Record<(typeof ACTIVITIES)[number], string> = {
  Badminton: 'Morning smash sessions through late mixed doubles. Walk in or lock a slot.',
  Basketball: 'Full-court nights, half-court mornings, and open shootaround on off-league days.',
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
      <SilkFilm className="gkh-film" startAt={0} />
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
        <div className="gkh-galacticos" aria-hidden="true" />
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
  const [open, setOpen] = useState<(typeof ACTIVITIES)[number] | null>(null);
  return (
    <section
      ref={ref}
      id="activities"
      className={`gka${inView ? ' is-in' : ''}`}
      style={{ backgroundImage: `url(${grain})` }}
    >
      <div className="gka-stripes" style={{ backgroundImage: `url(${stripes})` }} />
      <div className="gka-bar" />
      <img className="gka-queen" src={queen} alt="" />
      <img className="gka-ball" src={ball} alt="" />
      <img className="gka-dumbbells" src={dumbbells} alt="" />
      <h2 className="gka-title">ACTIVITIES</h2>
      <ul className="gka-list">
        {ACTIVITIES.map((name, index) => {
          const expanded = open === name;
          return (
            <li key={name} className={`gka-item${expanded ? ' is-open' : ''}`} style={{ ['--i' as string]: index }}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : name)}
              >
                {name}
              </button>
              <div className="gka-item__body" aria-hidden={!expanded}>
                <div className="gka-item__clip">
                  <p className="gka-item__copy">{ACTIVITY_COPY[name]}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Register() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} id="register" className={`gkr${inView ? ' is-in' : ''}`}>
      <SilkFilm className="gkr-film" startAt={5.4} />
      <div className="gkr-core">
        <h2 className="gkr-title">GYMKHANA</h2>
        <p className="gkr-sector">SECTOR 19</p>
        <img className="gkr-star" src={star} alt="" />
        <Link className="gkr-cta" to="/register">REGISTER<br />NOW</Link>
      </div>
      <p className="gkr-contact">
        <a className="gkr-phone" href="tel:+911010100001">+91 10101 00001</a>
        <a className="gkr-mail" href="mailto:Contact@gymkhana.com">Contact@gymkhana.com</a>
      </p>
    </section>
  );
}

export function SiteHome() {
  const navigate = useNavigate();
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
      const origin = root.getBoundingClientRect().top;
      const yOf = (el: Element) => root.scrollTop + (el.getBoundingClientRect().top - origin);
      const hero = root.querySelector('.gkh');
      const range = hero instanceof HTMLElement
        ? Math.max(1, hero.offsetHeight)
        : root.clientHeight;
      const heroT = Math.min(1, Math.max(0, root.scrollTop / (range * 0.8)));
      const next = heroT * heroT * (3 - 2 * heroT);
      const blendT = Math.min(1, Math.max(0, (root.scrollTop - range * 0.8) / (range * 0.2)));
      const blend = blendT * blendT * blendT * (blendT * (blendT * 6 - 15) + 10);
      const register = root.querySelector('.gkr');
      let reg = 0;
      if (register instanceof HTMLElement) {
        const top = yOf(register);
        const t = Math.min(1, Math.max(0, (root.scrollTop + root.clientHeight - top) / Math.max(1, root.clientHeight)));
        reg = t * t * (3 - 2 * t);
      }
      root.style.setProperty('--hero', next.toFixed(4));
      root.style.setProperty('--blend', blend.toFixed(4));
      root.style.setProperty('--reg', reg.toFixed(4));
      root.classList.toggle('is-docked', next >= 0.92 && reg < 0.08);
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
        <button type="button" className="gkh-account" aria-label="Sign in or register" aria-haspopup="dialog" onClick={() => {
          if (readMemberPass()) navigate('/member');
          else setGate(true);
        }}>
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
