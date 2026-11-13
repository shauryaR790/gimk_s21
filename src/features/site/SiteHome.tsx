import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { readMemberPass } from '../../lib/memberPass';
import { SIGNUP_ACTIVITIES } from '../../../shared/activities';
import grid from './assets/grid.jpg';
import star from './assets/star.png';
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
          <div className="gkh-lockup">
            <h1 className="gkh-brand">GYMKHANA</h1>
            <p className="gkh-sector">SECTOR 19</p>
          </div>
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
    >
      <h2 className="gka-title">ACTIVITIES</h2>
      <ul className="gka-list">
        {ACTIVITIES.map((name, index) => {
          const expanded = open === name;
          return (
            <li key={name} className={`gka-item${expanded ? ' is-open' : ''}`} style={{ ['--i' as string]: index }}>
              <button
                type="button"
                className="gka-item__name"
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
      <h2 className="gkr-title">GYMKHANA</h2>
      <p className="gkr-sector">SECTOR 19</p>
      <img className="gkr-star" src={star} alt="" />
      <Link className="gkr-cta" to="/register">REGISTER<br />NOW</Link>
      <a className="gkr-phone" href="tel:+911010100001">+91 10101 00001</a>
      <a className="gkr-mail" href="mailto:Contact@gymkhana.com">Contact@gymkhana.com</a>
    </section>
  );
}

export function SiteHome() {
  const navigate = useNavigate();
  const scrollerRef = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(false);
  const signedIn = Boolean(readMemberPass());
  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);
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
    let heroLatched = false;

    const update = () => {
      frame = 0;
      const y = root.scrollTop;
      const hero = root.querySelector('.gkh');
      const range = hero instanceof HTMLElement
        ? Math.max(1, hero.offsetHeight)
        : root.clientHeight;
      // Latch docked once past hero so Activities never undocks / bounces the title.
      if (y >= range * 0.88) heroLatched = true;
      if (y < range * 0.45) heroLatched = false;
      let next: number;
      if (heroLatched) {
        next = 1;
      } else {
        const heroT = Math.min(1, Math.max(0, y / (range * 0.8)));
        next = heroT * heroT * (3 - 2 * heroT);
      }
      const blendT = Math.min(1, Math.max(0, (y - range * 0.8) / (range * 0.2)));
      const blend = blendT * blendT * blendT * (blendT * (blendT * 6 - 15) + 10);

      const register = root.querySelector('.gkr');
      const onReg = register instanceof HTMLElement
        && y >= register.offsetTop - root.clientHeight * 0.15;
      const docked = heroLatched && !onReg;
      root.style.setProperty('--hero', next.toFixed(4));
      root.style.setProperty('--blend', blend.toFixed(4));
      root.style.setProperty('--reg', onReg ? '1' : '0');
      root.classList.toggle('is-away', next >= 0.5);
      root.classList.toggle('is-docked', docked);
      root.classList.toggle('is-reg', onReg);
      if (menuRef.current && !docked) {
        menuRef.current = false;
        setMenu(false);
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
    const root = scrollerRef.current;
    if (!root) return;
    root.classList.toggle('is-menu', menu);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  return (
    <main className="gks" ref={scrollerRef}>
      <header className="gks-bar">
        <button
          type="button"
          className="gkh-burger"
          aria-label={menu ? 'Close menu' : 'Open menu'}
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
        >
          <span /><span /><span />
        </button>
      </header>
      <div className={`gkh-veil${menu ? ' is-on' : ''}`} onClick={() => setMenu(false)} />
      <aside className={`gkh-side${menu ? ' is-open' : ''}`} aria-hidden={!menu}>
        <nav className="gkh-side__nav">
          <button
            type="button"
            className="gkh-side__link is-on"
            onClick={() => {
              setMenu(false);
              scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            Home
          </button>
          <button
            type="button"
            className="gkh-side__link"
            onClick={() => {
              setMenu(false);
              document.getElementById('activities')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Activities
          </button>
          {signedIn ? (
            <button
              type="button"
              className="gkh-side__link"
              onClick={() => {
                setMenu(false);
                navigate('/member');
              }}
            >
              Account
            </button>
          ) : (
            <>
              <Link className="gkh-side__link" to="/register" onClick={() => setMenu(false)}>Register</Link>
              <Link className="gkh-side__link" to="/login" onClick={() => setMenu(false)}>Login</Link>
            </>
          )}
        </nav>
      </aside>
      <div className="gks-silk-track">
        <SilkFilm className="gks-film" startAt={0} />
        <Hero />
        <Activities />
        <Register />
      </div>
    </main>
  );
}
