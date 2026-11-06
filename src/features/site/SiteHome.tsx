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

function Hero({ onAccount }: { onAccount: () => void }) {
  return (
    <section className="gkh" style={{ backgroundImage: `url(${grid})` }}>
      <button type="button" className="gkh-account" aria-label="Sign in or register" aria-haspopup="dialog" onClick={onAccount}>
        <img src={orb} alt="" />
      </button>
      <div className="gkh-stage">
        <h1 className="gkh-title">GYMKHANA</h1>
        <p className="gkh-sector">SECTOR 19</p>
        <img className="gkh-star" src={star} alt="" />
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
      <p className="gka-eyebrow">GYMKHANA</p>
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
    if (!gate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGate(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gate]);
  return (
    <main className="gks">
      <Hero onAccount={() => setGate(true)} />
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
