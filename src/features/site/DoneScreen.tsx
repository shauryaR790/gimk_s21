import { Link } from 'react-router-dom';
import star from './assets/star.png';
import './done.css';

type Props = {
  copy: string;
  continueLabel?: string;
  onContinue?: () => void;
  continueTo?: string;
};

export function DoneScreen({
  copy,
  continueLabel = 'Continue',
  onContinue,
  continueTo,
}: Props) {
  return (
    <section className="gk-done" aria-live="polite">
      <header className="gk-done__head">
        <Link to="/" className="gk-done__mark">GYMKHANA</Link>
        <p className="gk-done__sector">SECTOR 19</p>
      </header>
      <img className="gk-done__star" src={star} alt="" />
      <p className="gk-done__copy">{copy}</p>
      {onContinue ? (
        <button type="button" className="gk-done__go" onClick={onContinue}>
          {continueLabel}
        </button>
      ) : continueTo ? (
        <Link to={continueTo} className="gk-done__go" replace>
          {continueLabel}
        </Link>
      ) : null}
    </section>
  );
}
