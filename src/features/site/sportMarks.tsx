import badminton from './assets/icon-badminton.png';
import basketball from './assets/icon-basketball.png';
import football from './assets/icon-football.png';
import gym from './assets/icon-gym.png';
import skating from './assets/icon-skating.png';
import swimming from './assets/icon-swimming.png';
import tableTennis from './assets/icon-table-tennis.png';
import tennis from './assets/icon-tennis.png';

const MARKS: Record<string, string> = {
  Badminton: badminton,
  Basketball: basketball,
  Football: football,
  Gym: gym,
  Skating: skating,
  Swimming: swimming,
  Tennis: tennis,
  'Table tennis': tableTennis,
};

export function SportMark({ sport }: { sport: string }) {
  const src = MARKS[sport];
  if (!src) return null;
  return <img className="gka-card__icon" src={src} alt="" aria-hidden="true" />;
}
