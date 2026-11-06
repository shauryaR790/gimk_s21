import { useTitle } from '../../../lib/useTitle';
import { ChromeRecords } from './chrome';

export function BackendPlaceholderPage({ title }: { title: string }) {
  useTitle(title);
  return (
    <ChromeRecords items={[]} empty={`${title} is not available yet`}>
      {() => (
        <div className="o-be-placeholder">
          <p>{title} is not available yet</p>
        </div>
      )}
    </ChromeRecords>
  );
}
