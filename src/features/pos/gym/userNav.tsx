import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ACTIVE_USER_TABS, COMMUNICATIONS_TABS, communicationsTabId, peopleTabId } from '../staffSession';

export function ActiveUserSubnav() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const tab = peopleTabId(pathname, params.get('tab'));
  return (
    <nav className="o-be-subnav" aria-label="Active users">
      {ACTIVE_USER_TABS.map((item) => (
        <Link
          key={item.id}
          to={item.to}
          className={`o-be-subnav__link${tab === item.id ? ' is-on' : ''}`}
          aria-current={tab === item.id ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function CommunicationsSubnav() {
  const { pathname } = useLocation();
  const tab = communicationsTabId(pathname);
  return (
    <nav className="o-be-subnav" aria-label="Communications">
      {COMMUNICATIONS_TABS.map((item) => (
        <Link
          key={item.id}
          to={item.to}
          className={`o-be-subnav__link${tab === item.id ? ' is-on' : ''}`}
          aria-current={tab === item.id ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
