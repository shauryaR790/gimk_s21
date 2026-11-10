import ball from './assets/ball.png';
import dumbbells from './assets/dumbbells.png';
import badminton from './assets/icon-badminton.png';
import football from './assets/icon-football.png';
import swimming from './assets/icon-swimming.png';
import tableTennis from './assets/icon-table-tennis.png';
import tennis from './assets/icon-tennis.png';
import queen from './assets/queen.png';

const MARKS: Record<string, string> = {
  Badminton: badminton,
  Basketball: ball,
  Football: football,
  Gym: dumbbells,
  Skating: queen,
  Swimming: swimming,
  Tennis: tennis,
  'Table tennis': tableTennis,
};

export function SportMark({ sport }: { sport: string }) {
  const src = MARKS[sport];
  if (!src) return null;
  return <img className="gka-card__icon" src={src} alt="" />;
}
