import { useState, type FormEvent } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import { DoneScreen } from './DoneScreen';
import type { MemberCtx } from './MemberShell';

export function MemberReport() {
  const navigate = useNavigate();
  const { reload } = useOutletContext<MemberCtx>();
  const [issue, setIssue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (issue.trim().length < 4) {
      setError('Say what the issue is.');
      return;
    }
    setBusy(true);
    try {
      await api<{ note?: string }>('/api/portal/report', {
        method: 'POST',
        body: JSON.stringify({ issue, remarks }),
      });
      setIssue('');
      setRemarks('');
      reload();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that report.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <DoneScreen
        copy="Your report has been Completed you will receive a response on your registered mail id"
        onContinue={() => navigate('/member', { replace: true })}
      />
    );
  }

  return (
    <section className="gkm-sheet">
      <p className="gkm-brand">GYMKHANA<br /><span>SECTOR 19</span></p>
      <form className="gkm-form" onSubmit={(event) => void send(event)}>
        <div className="gkm-sheet__card">
          <h1>REPORT</h1>
          <label className="gkm-field">
            <span>Specify the issue</span>
            <input
              type="text"
              value={issue}
              maxLength={800}
              autoComplete="off"
              onChange={(event) => setIssue(event.target.value)}
            />
          </label>
          <label className="gkm-field">
            <span>Remarks</span>
            <input
              type="text"
              value={remarks}
              maxLength={400}
              autoComplete="off"
              onChange={(event) => setRemarks(event.target.value)}
            />
          </label>
          {error ? <p className="gkm-error" role="alert">{error}</p> : null}
          <button type="submit" className="gkm-submit" disabled={busy}>{busy ? 'SENDING' : 'SUBMIT'}</button>
        </div>
      </form>
    </section>
  );
}
