import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatINR } from '../../../../shared/domain';
import { SIGNUP_ACTIVITIES } from '../../../../shared/activities';
import { slotLabel, summarizeSlots } from '../../../../shared/slots';
import { TASK_CATEGORIES, TASK_PRIORITIES } from '../../../../shared/maintenance';
import { SlotGrid, type HeldSlot } from './slots';
import { api } from '../../../lib/api';
import { readIdImage } from '../../../lib/idImage';
import { pushToast } from '../../../components/Toast';
import { usePos } from '../PosContext';
import {
  BOOKING_STATUS,
  BookingStages,
  Choice,
  Dropdown,
  Field,
  Grid,
  Money,
  RecordForm,
  TabTable,
  pagerFor,
  toNumber,
  type Option,
} from './record';

type Trainer = { id: string; name: string; phone: string; email: string; specialization: string; availability: string; isActive?: boolean; freeSlots?: string[] };
type Plan = { id: string; name: string; durationDays: number; price: number; description: string; facilityAccess: string; bookingPrivileges: string; discountBps: number; guestPasses: number; renewalDays: number; freezeDays: number; isActive: boolean };
type Facility = {
  id: string;
  name: string;
  sport: string;
  location: string;
  description: string;
  capacity: number;
  opensAt: string;
  closesAt: string;
  slotMinutes: number;
  memberPrice: number;
  guestPrice: number;
  isAvailable: boolean;
  maintenanceStatus: string;
  using?: { name: string; member: boolean; coach: string }[];
};
type Member = {
  id: string;
  name: string;
  mobile: string;
  email: string;
  memberCode: string;
  membershipStatus: string;
  planName: string;
  expiresAt: string | null;
  accessInterest?: string;
  govtIdLabel?: string;
  govtIdUrl?: string;
  photoUrl?: string;
  coachId?: string;
  coachName?: string;
  notes?: string;
  notifyPrefs?: string;
  isMember?: boolean;
};
type Booking = {
  id: string;
  memberName: string;
  memberMobile: string;
  sport: string;
  facility: string;
  facilityId: string;
  startAt: string;
  endAt: string;
  participants: number;
  amount: number;
  paymentStatus: string;
  status: string;
  paymentMethod: string;
  customerId: string | null;
  notes: string;
};

const ZONE = 'Asia/Kolkata';

function todayYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONE });
}

function ymdOf(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONE });
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' });
}

function stamp(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { timeZone: ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function elapsedText(from: string, to?: string | null) {
  const minutes = Math.max(0, Math.floor(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 60000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this record.');
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, save };
}

function useList<T>(path: string, pick: (data: unknown) => T[]) {
  const [rows, setRows] = useState<T[]>([]);
  const { pathname } = useLocation();
  useEffect(() => {
    let live = true;
    void api<unknown>(path).then((data) => {
      if (live) setRows(pick(data));
    }).catch(() => undefined);
    return () => {
      live = false;
    };
    // pick is a stable inline selector for each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pathname]);
  return rows;
}

const trainerOptions = (trainers: Trainer[]): Option[] => [
  { value: '', label: 'No trainer' },
  ...trainers.map((trainer) => ({ value: trainer.id, label: `${trainer.name} · ${trainer.specialization}` })),
];

export function VisitorRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const { busy, error, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState('');
  const [govt, setGovt] = useState('');
  const [photo, setPhoto] = useState('');
  const [coachId, setCoachId] = useState('');
  const [planId, setPlanId] = useState('');
  const [notes, setNotes] = useState('');
  const [sms, setSms] = useState(true);
  const [mail, setMail] = useState(true);
  const [profile, setProfile] = useState<{
    member: Member;
    bookings: { id: string; facility: string; start_at: string; status: string; payment_status: string; amount: number }[];
    payments: { id: string; order_number: number; total: number; payment_status: string; created_at: string }[];
    checkIns: { id: string; facility_name: string; kind: string; checked_in_at: string; checked_out_at: string | null }[];
    outstanding: number;
    timeUsedMinutes: number;
  } | null>(null);
  const trainers = useList<Trainer>('/api/gym/trainers', (data) => (data as { trainers: Trainer[] }).trainers);
  const plans = useList<Plan>('/api/gym/plans', (data) => (data as { plans: Plan[] }).plans);
  const people = useList<Member>('/api/gym/members', (data) => (data as { members: Member[] }).members);

  const load = useCallback(async () => {
    if (isNew) return;
    const data = await api<NonNullable<typeof profile>>(`/api/gym/members/${id}`);
    setProfile(data);
    setName(data.member.name);
    setMobile(data.member.mobile);
    setEmail(data.member.email);
    setAccess(data.member.accessInterest ?? '');
    setGovt(data.member.govtIdLabel ?? '');
    setPhoto(data.member.photoUrl || data.member.govtIdUrl || '');
    setCoachId(data.member.coachId ?? '');
    setNotes(data.member.notes ?? '');
    const prefs = (data.member.notifyPrefs ?? 'sms,email').split(',');
    setSms(prefs.includes('sms'));
    setMail(prefs.includes('email'));
    setPlanId('');
  }, [id, isNew]);

  useEffect(() => {
    if (isNew) {
      setProfile(null);
      setName('');
      setMobile('');
      setEmail('');
      setAccess('');
      setGovt('');
      setPhoto('');
      setCoachId('');
      setPlanId('');
      setNotes('');
      return;
    }
    void load().catch(() => undefined);
  }, [isNew, load]);

  const member = profile?.member;
  const planChoices: Option[] = [
    { value: '', label: member?.isMember ? `Keep ${member.planName || 'current plan'}` : 'No plan yet' },
    ...plans.filter((plan) => plan.isActive).map((plan) => ({ value: plan.id, label: `${plan.name} · ${formatINR(plan.price)}` })),
  ];

  function submit() {
    void save(async () => {
      const body = {
        name,
        mobile,
        email,
        accessInterest: access,
        govtIdLabel: govt,
        govtIdUrl: member?.govtIdUrl || '',
        photoUrl: photo,
        coachId,
        notes,
        notifyPrefs: [sms ? 'sms' : '', mail ? 'email' : ''].filter(Boolean).join(','),
        ...(planId ? { planId } : {}),
      };
      if (isNew) {
        const created = await api<{ member: { id: string } }>('/api/gym/members', { method: 'POST', body: JSON.stringify(body) });
        pushToast('Visitor saved');
        navigate(`/pos/backend/visitors/${created.member.id}`, { replace: true });
        return;
      }
      await api(`/api/gym/members/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      pushToast('Visitor saved');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  const general = (
    <Grid
      left={(
        <>
          <Field label="Phone" required><input type="tel" value={mobile} aria-label="Phone" placeholder="98111 11111" onChange={(event) => setMobile(event.target.value)} /></Field>
          <Field label="Email"><input type="email" value={email} aria-label="Email" onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label="Wants to use"><input value={access} aria-label="Wants to use" placeholder="Badminton courts" onChange={(event) => setAccess(event.target.value)} /></Field>
          <Field label="Trainer"><Dropdown variant="field" label="Trainer" value={coachId} options={trainerOptions(trainers)} onChange={setCoachId} /></Field>
        </>
      )}
      right={(
        <>
          <Field label="Government ID"><input value={govt} aria-label="Government ID" placeholder="Aadhaar ending 4412" onChange={(event) => setGovt(event.target.value)} /></Field>
          <Field label="Membership"><Dropdown variant="field" label="Membership" value={planId} options={planChoices} onChange={setPlanId} /></Field>
          <Field label="Status"><strong>{member ? `${member.isMember ? 'Member' : 'Visitor'} · ${member.memberCode}${member.isMember && member.expiresAt ? ` · until ${member.expiresAt.slice(0, 10)}` : ''}` : 'New visitor'}</strong></Field>
          <Field label="Time on services"><strong>{profile ? `${profile.timeUsedMinutes} minutes` : '—'}</strong></Field>
          <Field label="Outstanding"><strong>{profile ? formatINR(profile.outstanding) : '—'}</strong></Field>
        </>
      )}
    />
  );

  return (
    <RecordForm
      kind="Visitor"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Visitors', to: '/pos/backend/visitors' }}
      name={name}
      onName={setName}
      namePlaceholder="e.g. Asha Menon"
      flags={[
        { label: 'SMS updates', checked: sms, onChange: setSms },
        { label: 'Email updates', checked: mail, onChange: setMail },
      ]}
      photo={{ url: photo, label: 'Photograph', onChange: (url) => setPhoto(url) }}
      documents={photo ? 1 : 0}
      pager={pagerFor(people.map((row) => row.id), id, '/pos/backend/visitors')}
      tabs={[
        { id: 'general', label: 'General Information', content: general },
        {
          id: 'bookings',
          label: 'Bookings',
          content: <TabTable head={['Facility', 'Start', 'Status', 'Payment', 'Amount']} empty="No bookings yet — create one from the Bookings page" rows={(profile?.bookings ?? []).map((row) => [row.facility, stamp(row.start_at), BOOKING_STATUS[row.status] ?? row.status, row.payment_status === 'PAID' ? 'Paid' : 'Due', formatINR(row.amount)])} />,
        },
        {
          id: 'payments',
          label: 'Payments',
          content: <TabTable head={['Bill', 'Date', 'Status', 'Total']} empty="No payments yet" rows={(profile?.payments ?? []).map((row) => [`#${row.order_number}`, stamp(row.created_at), row.payment_status, formatINR(row.total)])} />,
        },
        {
          id: 'checkins',
          label: 'Check-ins',
          content: <TabTable head={['Place', 'Kind', 'In', 'Out']} empty="No check-ins yet" rows={(profile?.checkIns ?? []).map((row) => [row.facility_name, row.kind, stamp(row.checked_in_at), row.checked_out_at ? stamp(row.checked_out_at) : 'Inside now'])} />,
        },
      ]}
      notes={{ value: notes, onChange: setNotes }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/visitors') : void load())}
      refreshKey={refreshKey}
    />
  );
}

export function PlanRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const { busy, error, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [price, setPrice] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [guests, setGuests] = useState('0');
  const [freeze, setFreeze] = useState('0');
  const [renewal, setRenewal] = useState('7');
  const [access, setAccess] = useState('ALL');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [memberPricing, setMemberPricing] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const facilities = useList<Facility>('/api/gym/facilities', (data) => (data as { facilities: Facility[] }).facilities);
  const holders = useList<Member>('/api/gym/members?filter=ACTIVE', (data) => (data as { members: Member[] }).members);

  const load = useCallback(async () => {
    const data = await api<{ plans: Plan[] }>('/api/gym/plans');
    setPlans(data.plans);
    if (isNew) return;
    const plan = data.plans.find((row) => row.id === id);
    if (!plan) return;
    setName(plan.name);
    setDays(String(plan.durationDays));
    setPrice(String(plan.price));
    setDiscount(String(plan.discountBps / 100));
    setGuests(String(plan.guestPasses));
    setFreeze(String(plan.freezeDays));
    setRenewal(String(plan.renewalDays));
    setAccess(plan.facilityAccess || 'ALL');
    setDescription(plan.description);
    setActive(plan.isActive);
    setMemberPricing(plan.bookingPrivileges !== 'Guest pricing');
  }, [id, isNew]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const sports = Array.from(new Set(facilities.map((facility) => facility.sport))).sort();
  const accessOptions: Option[] = [{ value: 'ALL', label: 'All facilities' }, ...sports.map((sport) => ({ value: sport, label: `${sport} only` }))];

  function submit() {
    void save(async () => {
      const body = {
        name,
        durationDays: toNumber(days),
        price: Math.round(toNumber(price)),
        description,
        facilityAccess: access,
        bookingPrivileges: memberPricing ? 'Member pricing' : 'Guest pricing',
        discountBps: Math.round(toNumber(discount) * 100),
        guestPasses: Math.round(toNumber(guests)),
        renewalDays: Math.round(toNumber(renewal)),
        freezeDays: Math.round(toNumber(freeze)),
        isActive: active,
      };
      if ([body.durationDays, body.price, body.discountBps, body.guestPasses, body.freezeDays, body.renewalDays].some((value) => !Number.isFinite(value))) {
        throw new Error('Use numbers for days, price, discount, guest passes, and freeze days.');
      }
      if (isNew) {
        const created = await api<{ plan: Plan }>('/api/gym/plans', { method: 'POST', body: JSON.stringify(body) });
        pushToast('Plan saved');
        navigate(`/pos/backend/plans/${created.plan.id}`, { replace: true });
        return;
      }
      await api(`/api/gym/plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      pushToast('Plan saved');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  const onPlan = holders.filter((member) => member.planName === name);
  return (
    <RecordForm
      kind="Plan"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Memberships', to: '/pos/backend/memberships' }}
      name={name}
      onName={setName}
      namePlaceholder="e.g. Monthly"
      flags={[
        { label: 'Active', checked: active, onChange: setActive },
        { label: 'Member pricing on bookings', checked: memberPricing, onChange: setMemberPricing },
      ]}
      pager={pagerFor(plans.map((plan) => plan.id), id, '/pos/backend/plans')}
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Field label="Duration" required suffix="days"><input value={days} inputMode="numeric" aria-label="Duration in days" onChange={(event) => setDays(event.target.value)} /></Field>
                  <Field label="Price" required suffix="per plan"><Money value={price} label="Price" onChange={setPrice} /></Field>
                  <Field label="Booking discount" suffix="%"><input value={discount} inputMode="decimal" aria-label="Booking discount" onChange={(event) => setDiscount(event.target.value)} /></Field>
                  <Field label="Facility access"><Dropdown variant="field" label="Facility access" value={access} options={accessOptions} onChange={setAccess} /></Field>
                </>
              )}
              right={(
                <>
                  <Field label="Guest passes"><input value={guests} inputMode="numeric" aria-label="Guest passes" onChange={(event) => setGuests(event.target.value)} /></Field>
                  <Field label="Freeze allowed" suffix="days"><input value={freeze} inputMode="numeric" aria-label="Freeze days" onChange={(event) => setFreeze(event.target.value)} /></Field>
                  <Field label="Renewal reminder" suffix="days before"><input value={renewal} inputMode="numeric" aria-label="Renewal reminder" onChange={(event) => setRenewal(event.target.value)} /></Field>
                  <Field label="Members on plan"><strong>{isNew ? '—' : onPlan.length}</strong></Field>
                </>
              )}
            />
          ),
        },
        {
          id: 'members',
          label: 'Members',
          content: <TabTable head={['Member', 'Phone', 'Status', 'Expires']} empty="No one is on this plan yet" rows={onPlan.map((member) => [member.name, member.mobile, member.membershipStatus, member.expiresAt ? member.expiresAt.slice(0, 10) : '—'])} />,
        },
      ]}
      notes={{ value: description, onChange: setDescription, placeholder: 'What this plan includes.' }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/memberships') : void load())}
      refreshKey={refreshKey}
    />
  );
}

export function TrainerRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const { busy, error, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sport, setSport] = useState('');
  const [hours, setHours] = useState('');
  const [govt, setGovt] = useState('');
  const [photo, setPhoto] = useState('');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [group, setGroup] = useState(true);
  const [solo, setSolo] = useState(true);
  const [classes, setClasses] = useState<{ id: string; name: string; category: string; schedule: string; capacity: number }[]>([]);
  const [sessions, setSessions] = useState<{ id: string; date: string; startTime: string; minutes: number; activity: string; kind: string; people: number; amount: number }[]>([]);
  const [freeSlots, setFreeSlots] = useState<string[]>([]);
  const [heldSlots, setHeldSlots] = useState<HeldSlot[]>([]);
  const trainers = useList<Trainer>('/api/gym/trainers', (data) => (data as { trainers: Trainer[] }).trainers);

  const load = useCallback(async () => {
    if (isNew) return;
    const data = await api<{
      trainer: Trainer & { govtIdLabel: string; govtIdUrl: string; notes: string; offers: string; isActive: boolean; freeSlots: string[] };
      classes: typeof classes;
      sessions: typeof sessions;
      heldSlots: HeldSlot[];
    }>(`/api/gym/trainers/${id}`);
    setFreeSlots(data.trainer.freeSlots);
    setHeldSlots(data.heldSlots);
    setName(data.trainer.name);
    setPhone(data.trainer.phone);
    setEmail(data.trainer.email);
    setSport(data.trainer.specialization);
    setHours(data.trainer.availability);
    setGovt(data.trainer.govtIdLabel);
    setPhoto(data.trainer.govtIdUrl);
    setNotes(data.trainer.notes);
    setActive(data.trainer.isActive);
    const offers = data.trainer.offers.split(',');
    setGroup(offers.includes('group'));
    setSolo(offers.includes('private'));
    setClasses(data.classes);
    setSessions(data.sessions);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  function submit() {
    void save(async () => {
      const body = {
        name,
        phone,
        email,
        specialization: sport,
        availability: hours,
        govtIdLabel: govt,
        govtIdUrl: photo,
        notes,
        isActive: active,
        offers: [group ? 'group' : '', solo ? 'private' : ''].filter(Boolean).join(','),
        freeSlots,
      };
      if (isNew) {
        const created = await api<{ trainer: { id: string } }>('/api/gym/trainers', { method: 'POST', body: JSON.stringify(body) });
        pushToast('Trainer saved');
        navigate(`/pos/backend/trainers/${created.trainer.id}`, { replace: true });
        return;
      }
      await api(`/api/gym/trainers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      pushToast('Trainer saved');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  const minutes = sessions.reduce((sum, row) => sum + row.minutes, 0);
  return (
    <RecordForm
      kind="Trainer"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Trainers', to: '/pos/backend/classes' }}
      name={name}
      onName={setName}
      namePlaceholder="e.g. Neha Kapoor"
      flags={[
        { label: 'Active', checked: active, onChange: setActive },
        { label: 'Group classes', checked: group, onChange: setGroup },
        { label: 'Private coaching', checked: solo, onChange: setSolo },
      ]}
      photo={{ url: photo, label: 'Government ID photo', onChange: (url, fileName) => { setPhoto(url); setGovt((current) => current || fileName.replace(/\.[^.]+$/, '')); } }}
      documents={photo ? 1 : 0}
      pager={pagerFor(trainers.map((row) => row.id), id, '/pos/backend/trainers')}
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Field label="Phone" required><input type="tel" value={phone} aria-label="Phone" placeholder="98222 22201" onChange={(event) => setPhone(event.target.value)} /></Field>
                  <Field label="Email"><input type="email" value={email} aria-label="Email" onChange={(event) => setEmail(event.target.value)} /></Field>
                  <Field label="Sport" required><input value={sport} aria-label="Sport" placeholder="Badminton" onChange={(event) => setSport(event.target.value)} /></Field>
                  <Field label="Hours">
                    {freeSlots.length
                      ? <strong className="gk-hours">{summarizeSlots(freeSlots)}</strong>
                      : <input value={hours} aria-label="Hours" placeholder="Pick free slots in the Free slots tab" onChange={(event) => setHours(event.target.value)} />}
                  </Field>
                </>
              )}
              right={(
                <>
                  <Field label="Government ID"><input value={govt} aria-label="Government ID" placeholder="Aadhaar ending 2201" onChange={(event) => setGovt(event.target.value)} /></Field>
                  <Field label="Classes"><strong>{isNew ? '—' : classes.length}</strong></Field>
                  <Field label="Sessions logged"><strong>{isNew ? '—' : sessions.length}</strong></Field>
                  <Field label="Minutes coached"><strong>{isNew ? '—' : minutes}</strong></Field>
                </>
              )}
            />
          ),
        },
        {
          id: 'slots',
          label: 'Free slots',
          content: <SlotGrid value={freeSlots} onChange={setFreeSlots} held={heldSlots} />,
        },
        {
          id: 'classes',
          label: 'Classes',
          content: <TabTable head={['Class', 'Category', 'Schedule', 'Capacity']} empty="No classes yet — assign this trainer on the Classes page" rows={classes.map((row) => [row.name, row.category || '—', row.schedule, row.capacity])} />,
        },
        {
          id: 'sessions',
          label: 'Sessions',
          content: <TabTable head={['Date', 'Start', 'Minutes', 'Session', 'Type', 'People', 'Amount']} empty="No sessions yet — the trainer logs them from their shift" rows={sessions.map((row) => [row.date, row.startTime, row.minutes, row.activity, row.kind, row.people, formatINR(row.amount)])} />,
        },
      ]}
      notes={{ value: notes, onChange: setNotes }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/classes') : void load())}
      refreshKey={refreshKey}
    />
  );
}

export function FacilityRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const { busy, error, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [name, setName] = useState('');
  const [sport, setSport] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [opens, setOpens] = useState('06:00');
  const [closes, setCloses] = useState('22:00');
  const [slot, setSlot] = useState('60');
  const [memberPrice, setMemberPrice] = useState('0');
  const [guestPrice, setGuestPrice] = useState('0');
  const [open, setOpen] = useState(true);
  const [description, setDescription] = useState('');
  const [list, setList] = useState<Facility[]>([]);
  const today = todayYmd();
  const bookings = useList<Booking>(isNew ? '/api/gym/bookings?date=none' : `/api/gym/bookings?date=${today}&facilityId=${id}`, (data) => (data as { bookings: Booking[] }).bookings);

  const load = useCallback(async () => {
    const data = await api<{ facilities: Facility[] }>('/api/gym/facilities');
    setList(data.facilities);
    if (isNew) return;
    const facility = data.facilities.find((row) => row.id === id);
    if (!facility) return;
    setName(facility.name);
    setSport(facility.sport);
    setLocation(facility.location);
    setCapacity(String(facility.capacity));
    setOpens(facility.opensAt);
    setCloses(facility.closesAt);
    setSlot(String(facility.slotMinutes));
    setMemberPrice(String(facility.memberPrice));
    setGuestPrice(String(facility.guestPrice));
    setOpen(facility.isAvailable && facility.maintenanceStatus === 'OK');
    setDescription(facility.description);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const current = list.find((row) => row.id === id);

  function submit() {
    void save(async () => {
      const body = {
        name,
        sport,
        location,
        description,
        capacity: Math.round(toNumber(capacity)),
        opens_at: opens,
        closes_at: closes,
        slot_minutes: Number(slot),
        member_price: Math.round(toNumber(memberPrice)),
        guest_price: Math.round(toNumber(guestPrice)),
        is_available: open ? 1 : 0,
        maintenance_status: open ? 'OK' : 'MAINTENANCE',
        access_rule: 'BOOKING',
      };
      if (!Number.isFinite(body.capacity) || body.capacity < 1) throw new Error('Enter how many people the facility holds.');
      if (!Number.isFinite(body.member_price) || !Number.isFinite(body.guest_price)) throw new Error('Enter the member and guest prices as numbers.');
      if (isNew) {
        const created = await api<{ facility: { id: string } }>('/api/gym/facilities', { method: 'POST', body: JSON.stringify(body) });
        pushToast('Facility saved');
        navigate(`/pos/backend/facilities/${created.facility.id}`, { replace: true });
        return;
      }
      await api(`/api/gym/facilities/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      pushToast('Facility saved');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  return (
    <RecordForm
      kind="Facility"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Facilities', to: '/pos/backend/facilities' }}
      name={name}
      onName={setName}
      namePlaceholder="e.g. Badminton Court 3"
      flags={[{ label: 'Open for booking', checked: open, onChange: setOpen }]}
      pager={pagerFor(list.map((row) => row.id), id, '/pos/backend/facilities')}
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Field label="Sport" required><input value={sport} aria-label="Sport" placeholder="Badminton" onChange={(event) => setSport(event.target.value)} /></Field>
                  <Field label="Location"><input value={location} aria-label="Location" placeholder="Indoor hall" onChange={(event) => setLocation(event.target.value)} /></Field>
                  <Field label="Capacity" required suffix="people"><input value={capacity} inputMode="numeric" aria-label="Capacity" onChange={(event) => setCapacity(event.target.value)} /></Field>
                  <Field label="Slot length">
                    <Dropdown variant="field" label="Slot length" value={slot} options={['30', '45', '60', '90', '120'].map((value) => ({ value, label: `${value} minutes` }))} onChange={setSlot} />
                  </Field>
                </>
              )}
              right={(
                <>
                  <Field label="Opens" required><input type="time" value={opens} aria-label="Opens" onChange={(event) => setOpens(event.target.value)} /></Field>
                  <Field label="Closes" required><input type="time" value={closes} aria-label="Closes" onChange={(event) => setCloses(event.target.value)} /></Field>
                  <Field label="Member price" required suffix="per slot"><Money value={memberPrice} label="Member price" onChange={setMemberPrice} /></Field>
                  <Field label="Guest price" required suffix="per slot"><Money value={guestPrice} label="Guest price" onChange={setGuestPrice} /></Field>
                </>
              )}
            />
          ),
        },
        {
          id: 'using',
          label: 'Using now',
          content: <TabTable head={['Name', 'Type', 'Trainer']} empty="No one is using this facility right now" rows={(current?.using ?? []).map((person) => [person.name, person.member ? 'Member' : 'Visitor', person.coach || '—'])} />,
        },
        {
          id: 'today',
          label: 'Bookings today',
          content: <TabTable head={['Visitor', 'Start', 'End', 'People', 'Status']} empty="No bookings today" rows={bookings.map((row) => [row.memberName, clock(row.startAt), clock(row.endAt), row.participants, BOOKING_STATUS[row.status] ?? row.status])} />,
        },
      ]}
      notes={{ value: description, onChange: setDescription }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/facilities') : void load())}
      refreshKey={refreshKey}
    />
  );
}

export function BookingRecordPage() {
  const { id } = useParams();
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const { busy, error, setError, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [mobile, setMobile] = useState('');
  const [facilityId, setFacilityId] = useState(query.get('facility') ?? '');
  const [date, setDate] = useState(query.get('date') ?? todayYmd());
  const [startAt, setStartAt] = useState('');
  const [duration, setDuration] = useState('60');
  const [people, setPeople] = useState('1');
  const [payNow, setPayNow] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('CONFIRMED');
  const [slots, setSlots] = useState<{ start: string; end: string; free: boolean }[]>([]);
  const facilities = useList<Facility>('/api/gym/facilities', (data) => (data as { facilities: Facility[] }).facilities);
  const members = useList<Member>('/api/gym/members', (data) => (data as { members: Member[] }).members);
  const all = useList<Booking>('/api/gym/bookings', (data) => (data as { bookings: Booking[] }).bookings);

  const load = useCallback(async () => {
    if (isNew) return;
    const data = await api<{ booking: Booking }>(`/api/gym/bookings/${id}`);
    const row = data.booking;
    setBooking(row);
    setName(row.memberName);
    setCustomerId(row.customerId ?? '');
    setMobile(row.memberMobile);
    setFacilityId(row.facilityId);
    setDate(ymdOf(row.startAt));
    setStartAt(row.startAt);
    setDuration(String(Math.round((new Date(row.endAt).getTime() - new Date(row.startAt).getTime()) / 60000)));
    setPeople(String(row.participants));
    setNotes(row.notes);
    setStatus(row.status);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this booking.'));
  }, [load, setError]);

  useEffect(() => {
    if (!facilityId && facilities[0] && isNew) setFacilityId(facilities[0].id);
  }, [facilities, facilityId, isNew]);

  useEffect(() => {
    if (!facilityId || !date) {
      setSlots([]);
      return;
    }
    let live = true;
    void api<{ slots: { start: string; end: string; free: boolean }[] }>(`/api/gym/slots?facilityId=${facilityId}&date=${date}&duration=${duration}`)
      .then((data) => {
        if (live) setSlots(data.slots);
      })
      .catch(() => {
        if (live) setSlots([]);
      });
    return () => {
      live = false;
    };
  }, [facilityId, date, duration, refreshKey]);

  const facility = facilities.find((row) => row.id === facilityId);
  const member = members.find((row) => row.id === customerId);
  const slotOptions: Option[] = useMemo(() => {
    const free = slots.filter((slot) => slot.free || slot.start === booking?.startAt).map((slot) => ({ value: slot.start, label: `${clock(slot.start)} – ${clock(slot.end)}` }));
    if (booking && !free.some((slot) => slot.value === booking.startAt) && ymdOf(booking.startAt) === date) {
      free.unshift({ value: booking.startAt, label: `${clock(booking.startAt)} – ${clock(booking.endAt)}` });
    }
    return free;
  }, [slots, booking, date]);

  useEffect(() => {
    if (startAt && !slotOptions.some((slot) => slot.value === startAt)) setStartAt('');
  }, [slotOptions, startAt]);

  const count = Math.max(1, Math.round(toNumber(people)) || 1);
  const unit = facility ? (member?.isMember ? facility.memberPrice : facility.guestPrice) : 0;

  function submit() {
    void save(async () => {
      if (!facilityId) throw new Error('Choose a facility.');
      if (!startAt) throw new Error('Choose a free time slot.');
      if (isNew) {
        const created = await api<{ booking: Booking }>('/api/gym/bookings', {
          method: 'POST',
          body: JSON.stringify({
            facilityId,
            customerId: customerId || null,
            memberName: name.trim() || 'Walk-in',
            memberMobile: mobile.trim() || undefined,
            startAt,
            durationMinutes: Number(duration),
            participants: count,
            payNow,
            paymentMethod: payNow ? method : '',
            notes,
          }),
        });
        pushToast('Booking created');
        navigate(`/pos/backend/bookings/${created.booking.id}`, { replace: true });
        return;
      }
      await api(`/api/gym/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ facilityId, startAt, participants: count, memberName: name, memberMobile: mobile, notes, status }),
      });
      pushToast(status === 'CANCELLED' ? 'Booking cancelled' : 'Booking saved');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  const memberOptions: Option[] = [{ value: '', label: 'Walk-in' }, ...members.map((row) => ({ value: row.id, label: `${row.name} · ${row.mobile}` }))];

  return (
    <RecordForm
      kind="Booking"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Bookings', to: '/pos/backend/bookings' }}
      name={name}
      onName={setName}
      namePlaceholder="e.g. Rahul Iyer"
      flags={isNew ? [{ label: 'Take payment now', checked: payNow, onChange: setPayNow }] : undefined}
      pager={pagerFor(all.map((row) => row.id), id, '/pos/backend/bookings')}
      saveLabel={isNew ? 'Reserve slot' : 'Save'}
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Field label="Visitor on file">
                    <Dropdown
                      variant="field"
                      label="Visitor on file"
                      value={customerId}
                      options={memberOptions}
                      onChange={(value) => {
                        setCustomerId(value);
                        const row = members.find((entry) => entry.id === value);
                        if (row) {
                          setName(row.name);
                          setMobile(row.mobile);
                        }
                      }}
                    />
                  </Field>
                  <Field label="Phone"><input type="tel" value={mobile} aria-label="Phone" placeholder="98111 11111" onChange={(event) => setMobile(event.target.value)} /></Field>
                  <Field label="People" required><input value={people} inputMode="numeric" aria-label="People" onChange={(event) => setPeople(event.target.value)} /></Field>
                  {isNew ? (
                    <Choice label="Payment" required={payNow} name="booking-pay" value={method} disabled={!payNow} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]} onChange={setMethod} />
                  ) : (
                    <Field label="Status"><BookingStages status={status} onPick={setStatus} /></Field>
                  )}
                </>
              )}
              right={(
                <>
                  <Field label="Facility" required>
                    <Dropdown variant="field" label="Facility" value={facilityId} placeholder="Choose a facility" options={facilities.map((row) => ({ value: row.id, label: row.name }))} onChange={setFacilityId} />
                  </Field>
                  <Field label="Date" required><input type="date" value={date} aria-label="Date" onChange={(event) => setDate(event.target.value)} /></Field>
                  {isNew ? (
                    <Field label="Duration">
                      <Dropdown variant="field" label="Duration" value={duration} options={['60', '90', '120'].map((value) => ({ value, label: `${value} minutes` }))} onChange={setDuration} />
                    </Field>
                  ) : null}
                  <Field label="Time slot" required>
                    <Dropdown variant="field" label="Time slot" value={startAt} placeholder={slotOptions.length ? 'Choose a free slot' : 'No free slots this day'} options={slotOptions} onChange={setStartAt} />
                  </Field>
                  <Field label="Price" suffix={member?.isMember ? 'member rate' : 'guest rate'}>
                    <strong>{booking ? formatINR(booking.amount) : facility ? formatINR(unit * count) : '—'}</strong>
                  </Field>
                </>
              )}
            />
          ),
        },
        {
          id: 'payment',
          label: 'Payment',
          content: (
            <TabTable
              head={['Amount', 'Payment', 'Method']}
              empty="Payment details appear after the booking is reserved"
              rows={booking ? [[formatINR(booking.amount), booking.paymentStatus, booking.paymentMethod || '—']] : []}
            />
          ),
        },
      ]}
      notes={{ value: notes, onChange: setNotes }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/bookings') : void load())}
      refreshKey={refreshKey}
    />
  );
}

type Task = {
  id: string;
  title: string;
  notes: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  actor?: string;
  facility: string;
  facility_id: string;
  category: string;
  priority: string;
  assigned_to: string;
  cost: number;
};

export function MaintenanceRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const pos = usePos();
  const isNew = !id || id === 'new';
  const { busy, error, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [title, setTitle] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('Repair');
  const [priority, setPriority] = useState('NORMAL');
  const [assignedTo, setAssignedTo] = useState('');
  const [cost, setCost] = useState('');
  const [block, setBlock] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const facilities = useList<Facility>('/api/gym/facilities', (data) => (data as { facilities: Facility[] }).facilities);

  const load = useCallback(async () => {
    const data = await api<{ records: Task[] }>('/api/gym/maintenance');
    setTasks(data.records);
    if (isNew) return;
    const task = data.records.find((row) => row.id === id);
    if (!task) return;
    setTitle(task.title);
    setFacilityId(task.facility_id);
    setNotes(task.notes);
    setCategory(task.category);
    setPriority(task.priority);
    setAssignedTo(task.assigned_to);
    setCost(task.cost ? String(task.cost) : '');
  }, [id, isNew]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const task = tasks.find((row) => row.id === id);

  function submit() {
    void save(async () => {
      if (!facilityId) throw new Error('Choose the facility.');
      if (!title.trim()) throw new Error('Enter the task.');
      const spent = cost.trim() ? toNumber(cost) : 0;
      if (!Number.isFinite(spent) || spent < 0) throw new Error('Enter the cost in rupees.');
      const details = { facilityId, title, notes, category, priority, assignedTo, cost: Math.round(spent) };
      if (isNew) {
        const created = await api<{ id: string }>('/api/gym/maintenance', { method: 'POST', body: JSON.stringify({ ...details, block }) });
        pushToast('Task added');
        navigate(`/pos/backend/maintenance/${created.id}`, { replace: true });
        return;
      }
      await api(`/api/gym/maintenance/${id}`, { method: 'PATCH', body: JSON.stringify(details) });
      pushToast('Task saved');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  function markDone() {
    void save(async () => {
      await api(`/api/gym/maintenance/${id}/close`, { method: 'POST', body: '{}' });
      pushToast('Task done');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  return (
    <RecordForm
      kind="Task"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Maintenance', to: '/pos/backend/maintenance' }}
      name={title}
      onName={setTitle}
      namePlaceholder="e.g. Re-tension court net"
      flags={isNew ? [{ label: 'Block the facility until done', checked: block, onChange: setBlock }] : undefined}
      pager={pagerFor(tasks.map((row) => row.id), id, '/pos/backend/maintenance')}
      actions={!isNew && task?.status === 'OPEN' ? <button type="button" className="gk-btn" disabled={busy} onClick={markDone}>Mark done</button> : null}
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Field label="Facility" required>
                    <Dropdown variant="field" label="Facility" value={facilityId} placeholder="Choose a facility" options={facilities.map((row) => ({ value: row.id, label: row.name }))} onChange={setFacilityId} />
                  </Field>
                  <Field label="Kind of work">
                    <Dropdown variant="field" label="Kind of work" value={category} options={TASK_CATEGORIES.map((value) => ({ value, label: value }))} onChange={setCategory} />
                  </Field>
                  <Field label="Priority">
                    <Dropdown variant="field" label="Priority" value={priority} options={TASK_PRIORITIES.map((row) => ({ value: row.value, label: row.label }))} onChange={setPriority} />
                  </Field>
                  <Field label="Assigned to"><input value={assignedTo} aria-label="Assigned to" placeholder="Staff member or vendor" onChange={(event) => setAssignedTo(event.target.value)} /></Field>
                </>
              )}
              right={(
                <>
                  <Field label="Raised by"><strong>{task?.actor || pos.user?.name || 'Staff'}</strong></Field>
                  <Field label="Started"><strong>{task ? stamp(task.starts_at) : 'When you save'}</strong></Field>
                  <Field label="Status"><strong>{task ? (task.status === 'OPEN' ? 'Open' : `Done ${stamp(task.ends_at)}`) : 'Open'}</strong></Field>
                  <Field label="Cost" suffix="parts and labour"><Money value={cost} label="Cost" onChange={setCost} /></Field>
                </>
              )}
            />
          ),
        },
      ]}
      notes={{ value: notes, onChange: setNotes, placeholder: 'What is wrong and what is needed.' }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/maintenance') : void load())}
      refreshKey={refreshKey}
    />
  );
}

type GymClass = { id: string; name: string; capacity: number; schedule: string };

export function ParticipantRecordPage() {
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const { busy, error, save } = useSaver();
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [classId, setClassId] = useState(query.get('class') ?? '');
  const [data, setData] = useState<{ classes: GymClass[]; registrations: { class_id: string; status: string }[] } | null>(null);
  const members = useList<Member>('/api/gym/members', (rows) => (rows as { members: Member[] }).members);

  useEffect(() => {
    void api<NonNullable<typeof data>>('/api/gym/classes').then(setData).catch(() => undefined);
  }, []);

  const klass = data?.classes.find((row) => row.id === classId);
  const taken = (data?.registrations ?? []).filter((row) => row.class_id === classId && row.status === 'REGISTERED').length;

  function submit() {
    void save(async () => {
      if (!classId) throw new Error('Choose the class.');
      if (name.trim().length < 2) throw new Error('Enter the participant name.');
      const result = await api<{ status: string }>(`/api/gym/classes/${classId}/register`, { method: 'POST', body: JSON.stringify({ name: name.trim(), customerId: customerId || null }) });
      pushToast(result.status === 'WAITLIST' ? 'Class is full — added to the waitlist' : 'Participant added');
      navigate('/pos/backend/classes');
    });
  }

  return (
    <RecordForm
      kind="Participant"
      crumb={{ label: 'Classes & Coaching', to: '/pos/backend/classes' }}
      name={name}
      onName={setName}
      namePlaceholder="e.g. Leela Nair"
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Field label="Class" required>
                    <Dropdown variant="field" label="Class" value={classId} placeholder="Choose a class" options={(data?.classes ?? []).map((row) => ({ value: row.id, label: `${row.name} · ${row.schedule}` }))} onChange={setClassId} />
                  </Field>
                  <Field label="Visitor on file">
                    <Dropdown
                      variant="field"
                      label="Visitor on file"
                      value={customerId}
                      options={[{ value: '', label: 'Not on file' }, ...members.map((row) => ({ value: row.id, label: `${row.name} · ${row.mobile}` }))]}
                      onChange={(value) => {
                        setCustomerId(value);
                        const row = members.find((entry) => entry.id === value);
                        if (row) setName(row.name);
                      }}
                    />
                  </Field>
                </>
              )}
              right={(
                <>
                  <Field label="Places taken"><strong>{klass ? `${taken} of ${klass.capacity}` : '—'}</strong></Field>
                  <Field label="Joins as"><strong>{klass ? (taken >= klass.capacity ? 'Waitlist' : 'Registered') : '—'}</strong></Field>
                </>
              )}
            />
          ),
        },
      ]}
      error={error}
      busy={busy}
      saveLabel="Add participant"
      onSave={submit}
      onDiscard={() => navigate('/pos/backend/classes')}
    />
  );
}

type SessionLine = {
  key: string;
  startTime: string;
  minutes: string;
  facility: string;
  activity: string;
  kind: string;
  people: string;
  visitors: string;
  amount: string;
  payment: string;
};

type ShiftDetail = {
  id: string;
  type: string;
  subjectId: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  phone: string;
  email: string;
  roleLabel: string;
  govtIdLabel: string;
  govtIdUrl: string;
  areas: string;
  notes: string;
  bookings: number;
  checkIns: number;
};

const SESSION_KINDS = ['Group class', 'Private coaching', 'Team practice', 'Assessment', 'Camp'];
const SESSION_PAYMENTS = ['Included in plan', 'Paid · Cash', 'Paid · UPI', 'Paid · Card', 'Due'];
const STAFF_TITLES = ['Receptionist', 'Cashier', 'Facility manager', 'Inventory manager', 'Duty manager'];
const TRAINER_TITLES = ['Head trainer', 'Trainer', 'Assistant trainer'];

function blankLine(): SessionLine {
  return {
    key: Math.random().toString(36).slice(2),
    startTime: '',
    minutes: '60',
    facility: '',
    activity: '',
    kind: 'Group class',
    people: '1',
    visitors: '',
    amount: '0',
    payment: 'Included in plan',
  };
}

export function ShiftRecordPage() {
  const { id } = useParams();
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const pos = usePos();
  const isNew = !id || id === 'new';
  const { busy, error, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [role, setRole] = useState(query.get('role') === 'trainer' ? 'TRAINER' : 'STAFF');
  const [trainerId, setTrainerId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [govt, setGovt] = useState('');
  const [photo, setPhoto] = useState('');
  const [areas, setAreas] = useState<string[]>(['Front desk']);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<SessionLine[]>([]);
  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [shiftIds, setShiftIds] = useState<string[]>([]);
  const facilities = useList<Facility>('/api/gym/facilities', (data) => (data as { facilities: Facility[] }).facilities);

  const load = useCallback(async () => {
    const list = await api<{ shifts: { id: string }[]; trainers: Trainer[] }>('/api/gym/shifts');
    setTrainers(list.trainers);
    setShiftIds(list.shifts.map((row) => row.id));
    if (isNew) return;
    const data = await api<{ shift: ShiftDetail; sessions: (Omit<SessionLine, 'key' | 'minutes' | 'people' | 'amount'> & { id: string; minutes: number; people: number; amount: number })[] }>(`/api/gym/shifts/${id}`);
    const row = data.shift;
    setShift(row);
    setRole(row.type === 'TRAINER' ? 'TRAINER' : 'STAFF');
    setTrainerId(row.type === 'TRAINER' ? row.subjectId : '');
    setName(row.name);
    setPhone(row.phone);
    setEmail(row.email);
    setTitle(row.roleLabel);
    setGovt(row.govtIdLabel);
    setPhoto(row.govtIdUrl);
    setAreas(row.areas ? row.areas.split(',').filter(Boolean) : []);
    setNotes(row.notes);
    setLines(data.sessions.map((entry) => ({
      key: entry.id,
      startTime: entry.startTime,
      minutes: String(entry.minutes),
      facility: entry.facility,
      activity: entry.activity,
      kind: entry.kind,
      people: String(entry.people),
      visitors: entry.visitors,
      amount: String(entry.amount),
      payment: entry.payment,
    })));
  }, [id, isNew]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!isNew) return;
    if (role === 'STAFF') {
      setTrainerId('');
      setName((current) => current || pos.user?.name || '');
      setTitle((current) => (STAFF_TITLES.includes(current) ? current : 'Receptionist'));
      setAreas((current) => (current.length ? current : ['Front desk']));
      setLines([]);
    } else {
      setTitle((current) => (TRAINER_TITLES.includes(current) ? current : 'Trainer'));
      setAreas(['Coaching']);
      setLines((current) => (current.length ? current : [blankLine()]));
    }
  }, [role, isNew, pos.user?.name]);

  function pickTrainer(value: string) {
    setTrainerId(value);
    const trainer = trainers.find((row) => row.id === value);
    if (!trainer) return;
    setName(trainer.name);
    setPhone(trainer.phone);
    setEmail(trainer.email ?? '');
  }

  function patchLine(key: string, patch: Partial<SessionLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  const isTrainer = role === 'TRAINER';
  const sessionsBody = lines.map((line) => ({
    date: shift ? new Date(shift.startedAt).toLocaleDateString('en-CA', { timeZone: ZONE }) : todayYmd(),
    startTime: line.startTime,
    minutes: Number(line.minutes),
    facility: line.facility,
    activity: line.activity,
    kind: line.kind,
    people: Number(line.people),
    visitors: line.visitors,
    amount: Math.round(toNumber(line.amount) || 0),
    payment: line.payment,
  }));

  const details = {
    name,
    phone,
    email,
    roleLabel: title,
    govtIdLabel: govt,
    govtIdUrl: photo,
    areas: areas.join(','),
    notes,
    ...(isTrainer ? { sessions: sessionsBody } : {}),
  };

  function submit() {
    void save(async () => {
      if (isNew) {
        if (isTrainer && !trainerId) throw new Error('Choose which trainer is clocking in.');
        const started = await api<{ shift: { id: string } }>('/api/gym/shifts', {
          method: 'POST',
          body: JSON.stringify({ ...details, type: role, trainerId }),
        });
        pushToast('Shift started');
        navigate(`/pos/backend/shift/${started.shift.id}`, { replace: true });
        return;
      }
      await api(`/api/gym/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(details) });
      pushToast(isTrainer ? 'Shift and sessions saved' : 'Shift saved');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  function clockOut() {
    void save(async () => {
      await api(`/api/gym/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(details) });
      await api(`/api/gym/shifts/${id}/end`, { method: 'POST', body: '{}' });
      pushToast('Clocked out');
      await load();
      setRefreshKey((value) => value + 1);
    });
  }

  const titleOptions = (isTrainer ? TRAINER_TITLES : STAFF_TITLES).map((value) => ({ value, label: value }));
  const facilityOptions: Option[] = [{ value: '', label: 'No facility' }, ...facilities.map((row) => ({ value: row.name, label: row.name }))];
  const totalMinutes = lines.reduce((sum, line) => sum + (Number(line.minutes) || 0), 0);
  const collected = lines.filter((line) => line.payment.startsWith('Paid')).reduce((sum, line) => sum + (Math.round(toNumber(line.amount)) || 0), 0);
  const toggleArea = (area: string) => (checked: boolean) => setAreas((current) => (checked ? Array.from(new Set([...current, area])) : current.filter((entry) => entry !== area)));

  const sessionsBlock = isTrainer ? (
    <section className="gk-lines">
      <header>
        <h3>Sessions taken today</h3>
        <span>{lines.length} {lines.length === 1 ? 'session' : 'sessions'} · {totalMinutes} minutes · {formatINR(collected)} collected</span>
      </header>
      <div className="gk-lines__wrap">
        <table className="o-be-table">
          <thead>
            <tr><th>Start</th><th>Minutes</th><th>Facility</th><th>Session</th><th>Type</th><th>People</th><th>Visitors</th><th>Amount</th><th>Payment</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.key}>
                <td><input type="time" value={line.startTime} aria-label={`Session ${index + 1} start`} onChange={(event) => patchLine(line.key, { startTime: event.target.value })} /></td>
                <td><input className="is-short" value={line.minutes} inputMode="numeric" aria-label={`Session ${index + 1} minutes`} onChange={(event) => patchLine(line.key, { minutes: event.target.value })} /></td>
                <td><Dropdown variant="field" label={`Session ${index + 1} facility`} value={line.facility} options={facilityOptions} onChange={(value) => patchLine(line.key, { facility: value })} /></td>
                <td><input value={line.activity} placeholder="Morning badminton coaching" aria-label={`Session ${index + 1} what it was`} onChange={(event) => patchLine(line.key, { activity: event.target.value })} /></td>
                <td><Dropdown variant="field" label={`Session ${index + 1} type`} value={line.kind} options={SESSION_KINDS.map((value) => ({ value, label: value }))} onChange={(value) => patchLine(line.key, { kind: value })} /></td>
                <td><input className="is-short" value={line.people} inputMode="numeric" aria-label={`Session ${index + 1} people`} onChange={(event) => patchLine(line.key, { people: event.target.value })} /></td>
                <td><input value={line.visitors} placeholder="Names" aria-label={`Session ${index + 1} visitors`} onChange={(event) => patchLine(line.key, { visitors: event.target.value })} /></td>
                <td><input className="is-short" value={line.amount} inputMode="decimal" aria-label={`Session ${index + 1} amount`} onChange={(event) => patchLine(line.key, { amount: event.target.value })} /></td>
                <td><Dropdown variant="field" label={`Session ${index + 1} payment`} value={line.payment} options={SESSION_PAYMENTS.map((value) => ({ value, label: value }))} onChange={(value) => patchLine(line.key, { payment: value })} /></td>
                <td><button type="button" className="gk-btn gk-btn--sm" onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>Remove</button></td>
              </tr>
            ))}
            {!lines.length ? <tr><td colSpan={10} className="o-be-table__empty">No sessions yet — add each session taken today</td></tr> : null}
          </tbody>
        </table>
      </div>
      <button type="button" className="gk-btn gk-btn--sm" onClick={() => setLines((current) => [...current, blankLine()])}>Add a session</button>
    </section>
  ) : null;

  return (
    <RecordForm
      kind="Shift"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Shift', to: '/pos/backend/shift' }}
      name={name}
      onName={setName}
      namePlaceholder="Full name"
      flags={['Front desk', 'Facility floor', 'Coaching'].map((area) => ({ label: area, checked: areas.includes(area), onChange: toggleArea(area) }))}
      photo={{ url: photo, label: 'ID photo', onChange: (url, fileName) => { setPhoto(url); setGovt((current) => current || fileName.replace(/\.[^.]+$/, '')); } }}
      documents={photo ? 1 : 0}
      pager={pagerFor(shiftIds, id, '/pos/backend/shift')}
      saveLabel={isNew ? 'Start shift' : 'Save'}
      actions={!isNew && shift && !shift.endedAt ? <button type="button" className="gk-btn" disabled={busy} onClick={clockOut}>Clock out</button> : null}
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Choice label="Role" required name="shift-role" value={role} disabled={!isNew} options={[{ value: 'STAFF', label: 'Staff' }, { value: 'TRAINER', label: 'Trainer' }]} onChange={setRole} />
                  {isTrainer ? (
                    <Field label="Trainer" required>
                      <Dropdown variant="field" label="Trainer" value={trainerId} placeholder="Choose a trainer" disabled={!isNew} options={trainers.map((row) => ({ value: row.id, label: `${row.name} · ${row.specialization}` }))} onChange={pickTrainer} />
                    </Field>
                  ) : null}
                  <Field label="Job title"><Dropdown variant="field" label="Job title" value={title} options={titleOptions} onChange={setTitle} /></Field>
                  <Field label="Phone" required><input type="tel" value={phone} aria-label="Phone" placeholder="98111 11111" onChange={(event) => setPhone(event.target.value)} /></Field>
                  <Field label="Email"><input type="email" value={email} aria-label="Email" onChange={(event) => setEmail(event.target.value)} /></Field>
                </>
              )}
              right={(
                <>
                  <Field label="Government ID"><input value={govt} aria-label="Government ID" placeholder="Aadhaar ending 4412" onChange={(event) => setGovt(event.target.value)} /></Field>
                  <Field label="Clock in"><strong>{shift ? stamp(shift.startedAt) : 'When you start the shift'}</strong></Field>
                  <Field label="Clock out"><strong>{shift?.endedAt ? stamp(shift.endedAt) : shift ? 'Still on shift' : '—'}</strong></Field>
                  <Field label="Time on shift"><strong>{shift ? elapsedText(shift.startedAt, shift.endedAt) : '—'}</strong></Field>
                </>
              )}
            />
          ),
        },
        {
          id: 'activity',
          label: 'Shift activity',
          content: (
            <TabTable
              head={['Bookings taken', 'Check-ins', 'Sessions logged', 'Minutes coached', 'Collected']}
              empty="Activity appears once the shift has started"
              rows={shift ? [[shift.bookings, shift.checkIns, lines.length, totalMinutes, formatINR(collected)]] : []}
            />
          ),
        },
      ]}
      below={sessionsBlock}
      notes={{ value: notes, onChange: setNotes, placeholder: 'Handover notes for the next shift.' }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/shift') : void load())}
      refreshKey={refreshKey}
    />
  );
}

type StockItem = { id: string; name: string; sku: string; category: string; unit: string; qty: number; reorderLevel: number; costPerUnit: number; supplier: string };

export function InventoryRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const { busy, error, save } = useSaver();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('0');
  const [reorder, setReorder] = useState('0');
  const [cost, setCost] = useState('0');
  const [sku, setSku] = useState('');
  const [supplier, setSupplier] = useState('Gymkhana stores');
  const [items, setItems] = useState<StockItem[]>([]);

  const load = useCallback(async () => {
    const data = await api<{ items: StockItem[] }>('/api/inventory');
    const training = data.items.filter((row) => row.category === 'Training');
    setItems(training);
    if (isNew) return;
    const item = training.find((row) => row.id === id);
    if (!item) return;
    setName(item.name);
    setQty(String(item.qty));
    setReorder(String(item.reorderLevel));
    setCost(String(item.costPerUnit));
    setSku(item.sku);
    setSupplier(item.supplier);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const current = items.find((row) => row.id === id);
  const value = (toNumber(qty) || 0) * (toNumber(cost) || 0);

  function submit() {
    void save(async () => {
      const count = toNumber(qty);
      const level = toNumber(reorder);
      const price = Math.round(toNumber(cost));
      if (!name.trim()) throw new Error('Enter the item name.');
      if (!Number.isFinite(count) || count < 0) throw new Error('Enter how many pieces are on hand.');
      if (!Number.isFinite(level) || level < 0) throw new Error('Enter the reorder level as a number.');
      if (!Number.isFinite(price) || price < 0) throw new Error('Enter the cost per piece.');
      if (isNew) {
        const created = await api<{ item: { id: string } }>('/api/inventory/items', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), sku: sku.trim(), category: 'Training', unit: 'pcs', qty: count, reorderLevel: level, costPerUnit: price, supplier: supplier.trim() }),
        });
        pushToast('Added to stock');
        navigate(`/pos/backend/inventory/${created.item.id}`, { replace: true });
        return;
      }
      await api(`/api/inventory/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), sku: sku.trim(), reorderLevel: level, costPerUnit: price, supplier: supplier.trim() }),
      });
      if (current && count !== current.qty) {
        await api('/api/inventory/movements', {
          method: 'POST',
          body: JSON.stringify({ itemId: id, kind: 'ADJUSTMENT', qty: count - current.qty, notes: 'Counted on the item page' }),
        });
      }
      pushToast('Item saved');
      await load();
    });
  }

  return (
    <RecordForm
      kind="Item"
      recordId={isNew ? undefined : id}
      crumb={{ label: 'Inventory', to: '/pos/backend/inventory' }}
      name={name}
      onName={setName}
      namePlaceholder="e.g. Badminton racket"
      pager={pagerFor(items.map((row) => row.id), id, '/pos/backend/inventory')}
      tabs={[
        {
          id: 'general',
          label: 'General Information',
          content: (
            <Grid
              left={(
                <>
                  <Field label="On hand" required suffix="pieces"><input value={qty} inputMode="numeric" aria-label="On hand" onChange={(event) => setQty(event.target.value)} /></Field>
                  <Field label="Reorder at" suffix="pieces"><input value={reorder} inputMode="numeric" aria-label="Reorder at" onChange={(event) => setReorder(event.target.value)} /></Field>
                  <Field label="Cost" required suffix="per piece"><Money value={cost} label="Cost per piece" onChange={setCost} /></Field>
                </>
              )}
              right={(
                <>
                  <Field label="SKU"><input value={sku} aria-label="SKU" placeholder="EQ-RKT" onChange={(event) => setSku(event.target.value)} /></Field>
                  <Field label="Supplier"><input value={supplier} aria-label="Supplier" onChange={(event) => setSupplier(event.target.value)} /></Field>
                  <Field label="Stock value"><strong>{formatINR(Math.round(value))}</strong></Field>
                </>
              )}
            />
          ),
        },
      ]}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => (isNew ? navigate('/pos/backend/inventory') : void load())}
    />
  );
}

export type JoinRequest = {
  id: string;
  ref: string;
  sport: string;
  name: string;
  mobile: string;
  email: string;
  dob: string;
  age: number | null;
  govtIdLabel: string;
  govtIdUrl: string;
  hasIdPhoto: boolean;
  wantsTrainer: boolean;
  route: 'TRAINER' | 'STAFF';
  trainerId: string;
  trainerName: string;
  trainerPhone: string;
  preferredSlot: string;
  preferredSlotLabel: string;
  planId: string;
  planName: string;
  planDays: number;
  amount: number;
  paymentStatus: string;
  paymentMethod: string;
  orderNumber: number | null;
  customerId: string;
  status: string;
  handledBy: string;
  notes: string;
  pincode: string;
  photoUrl: string;
  hasPortrait: boolean;
  hasPassword: boolean;
  isMember: boolean;
  becomeMember: boolean;
  createdAt: string;
};

export const JOIN_STATUS: Record<string, string> = { NEW: 'New', CONTACTED: 'Contacted', APPROVED: 'Approved', DECLINED: 'Declined' };

export function joinPayment(row: Pick<JoinRequest, 'paymentStatus' | 'paymentMethod' | 'orderNumber'>) {
  if (row.paymentStatus === 'PAID') return `Paid · ${row.paymentMethod || 'Desk'}${row.orderNumber ? ` · bill ${row.orderNumber}` : ''}`;
  if (row.paymentStatus === 'REFUNDED') return 'Refunded';
  return 'Due at desk';
}

export function JoinRequestRecordPage({ route }: { route: 'TRAINER' | 'STAFF' }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const base = route === 'TRAINER' ? '/pos/backend/trainer-requests' : '/pos/backend/membership-requests';
  const { busy, error, setError, save } = useSaver();
  const [refreshKey, setRefreshKey] = useState(0);
  const [request, setRequest] = useState<JoinRequest | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [govt, setGovt] = useState('');
  const [photo, setPhoto] = useState('');
  const [idShot, setIdShot] = useState('');
  const [sport, setSport] = useState('');
  const [wantsTrainer, setWantsTrainer] = useState(false);
  const [trainerId, setTrainerId] = useState('');
  const [slot, setSlot] = useState('');
  const [planId, setPlanId] = useState('');
  const [notes, setNotes] = useState('');
  const [pincode, setPincode] = useState('');
  const [isMember, setIsMember] = useState(false);
  const [becomeMember, setBecomeMember] = useState(false);
  const [method, setMethod] = useState('');
  const [confirmDecline, setConfirmDecline] = useState(false);
  const trainers = useList<Trainer>('/api/gym/trainers', (data) => (data as { trainers: Trainer[] }).trainers);
  const plans = useList<Plan>('/api/gym/plans', (data) => (data as { plans: Plan[] }).plans);
  const facilities = useList<Facility>('/api/gym/facilities', (data) => (data as { facilities: Facility[] }).facilities);
  const siblings = useList<JoinRequest>(`/api/gym/join-requests?route=${route}`, (data) => (data as { requests: JoinRequest[] }).requests);

  const fill = useCallback((row: JoinRequest) => {
    setRequest(row);
    setName(row.name);
    setMobile(row.mobile);
    setEmail(row.email);
    setDob(row.dob);
    setGovt(row.govtIdLabel);
    setPhoto(row.photoUrl);
    setIdShot(row.govtIdUrl);
    setSport(row.sport);
    setWantsTrainer(row.wantsTrainer);
    setTrainerId(row.trainerId);
    setSlot(row.preferredSlot);
    setPlanId(row.planId);
    setNotes(row.notes);
    setPincode(row.pincode);
    setIsMember(row.isMember);
    setBecomeMember(row.becomeMember);
  }, []);

  const load = useCallback(async () => {
    const data = await api<{ request: JoinRequest }>(`/api/gym/join-requests/${id}`);
    fill(data.request);
    setRefreshKey((value) => value + 1);
  }, [fill, id]);

  useEffect(() => {
    setConfirmDecline(false);
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load this request.'));
  }, [load, setError]);

  useEffect(() => {
    if (!confirmDecline) return;
    const timer = window.setTimeout(() => setConfirmDecline(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDecline]);

  const open = request ? request.status === 'NEW' || request.status === 'CONTACTED' : false;
  const paid = request?.paymentStatus === 'PAID';
  const sportOptions = useMemo(() => {
    const names = [...new Set([...SIGNUP_ACTIVITIES, ...facilities.map((row) => row.sport.trim()).filter(Boolean)])].sort();
    return names.map((value) => ({ value, label: value }));
  }, [facilities]);
  const trainer = trainers.find((row) => row.id === trainerId);
  const trainerChoices: Option[] = [
    { value: '', label: 'Any trainer' },
    ...[...trainers]
      .filter((row) => row.isActive !== false)
      .sort((a, b) => Number(b.specialization.toLowerCase() === sport.toLowerCase()) - Number(a.specialization.toLowerCase() === sport.toLowerCase()) || a.name.localeCompare(b.name))
      .map((row) => ({ value: row.id, label: `${row.name} · ${row.specialization}` })),
  ];
  const slotChoices: Option[] = [
    { value: '', label: 'No preference' },
    ...(trainer?.freeSlots ?? []).map((value) => ({ value, label: slotLabel(value) })),
    ...(slot && !(trainer?.freeSlots ?? []).includes(slot) ? [{ value: slot, label: `${slotLabel(slot)} · not free` }] : []),
  ];
  const plan = plans.find((row) => row.id === planId);

  function submit() {
    void save(async () => {
      const data = await api<{ request: JoinRequest }>(`/api/gym/join-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, mobile, email, dob, pincode, govtIdLabel: govt, govtIdUrl: idShot, photoUrl: photo, sport, wantsTrainer, trainerId, preferredSlot: slot, planId, isMember, becomeMember, notes }),
      });
      pushToast('Request saved');
      fill(data.request);
      setRefreshKey((value) => value + 1);
      if (data.request.route !== route) {
        navigate(`${data.request.route === 'TRAINER' ? '/pos/backend/trainer-requests' : '/pos/backend/membership-requests'}/${id}`, { replace: true });
      }
    });
  }

  function act(path: string, body: Record<string, unknown>, done: string) {
    void save(async () => {
      const data = await api<{ request: JoinRequest; note?: string }>(`/api/gym/join-requests/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) });
      pushToast(data.note || done);
      fill(data.request);
      setRefreshKey((value) => value + 1);
    });
  }

  const actions = request ? (
    <>
      {request.status === 'NEW' ? <button type="button" className="gk-btn" disabled={busy} onClick={() => act('contacted', {}, 'Marked contacted')}>Mark contacted</button> : null}
      {open ? (
        <button
          type="button"
          className="gk-btn"
          disabled={busy}
          onClick={() => {
            if (!paid && !method) {
              setError('Not paid yet. Pick cash, UPI or card in "Take payment by" on General Information, then approve.');
              return;
            }
            act('approve', { method, notes }, 'Approved · membership is active');
          }}
        >
          Approve
        </button>
      ) : null}
      {open ? (
        <button
          type="button"
          className="gk-btn"
          disabled={busy}
          onClick={() => {
            if (!confirmDecline) {
              setConfirmDecline(true);
              return;
            }
            setConfirmDecline(false);
            act('decline', { reason: notes.split('\n')[0] ?? '', notes }, 'Request declined');
          }}
        >
          {confirmDecline ? (paid ? 'Confirm decline & refund' : 'Confirm decline') : 'Decline'}
        </button>
      ) : null}
      {request.status === 'APPROVED' && request.customerId ? <button type="button" className="gk-btn" onClick={() => navigate(`/pos/backend/visitors/${request.customerId}`)}>Open visitor</button> : null}
    </>
  ) : null;

  const tabs = [
    {
      id: 'general',
      label: 'General Information',
      content: (
        <Grid
          left={(
            <>
              <Field label="Phone" required>
                <input type="tel" value={mobile} aria-label="Phone" onChange={(event) => setMobile(event.target.value)} />
                {mobile ? <a className="gk-link" href={`tel:+91${mobile.replace(/\D/g, '').slice(-10)}`}>Call</a> : null}
              </Field>
              <Field label="Email" required>
                <input type="email" value={email} aria-label="Email" onChange={(event) => setEmail(event.target.value)} />
                {email ? <a className="gk-link" href={`mailto:${email}`}>Email</a> : null}
              </Field>
              <Field label="Login password"><strong>{request?.hasPassword ? 'Set on website' : 'Not set'}</strong></Field>
              <Field label="Pincode"><input inputMode="numeric" value={pincode} aria-label="Pincode" onChange={(event) => setPincode(event.target.value)} /></Field>
              <Field label="Date of birth" required suffix={request?.age != null ? `${request.age} yrs` : undefined}>
                <input type="date" value={dob} aria-label="Date of birth" onChange={(event) => setDob(event.target.value)} />
              </Field>
              <Field label="Government ID" required>
                <input value={govt} aria-label="Government ID" onChange={(event) => setGovt(event.target.value)} />
                {idShot ? <img className="gk-id" src={idShot} alt="Government ID" /> : null}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Government ID photo"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    void readIdImage(file).then(setIdShot).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not read that photo.'));
                  }}
                />
              </Field>
              <Field label="Sport" required>
                <Dropdown variant="field" label="Sport" value={sport} options={sportOptions} onChange={setSport} disabled={!open} />
              </Field>
            </>
          )}
          right={(
            <>
              <Field label="Plan" required>
                <Dropdown
                  variant="field"
                  label="Plan"
                  value={planId}
                  options={plans.filter((row) => row.isActive || row.id === planId).map((row) => ({ value: row.id, label: `${row.name} · ${row.durationDays} days` }))}
                  onChange={setPlanId}
                  disabled={!open || paid}
                />
              </Field>
              <Field label="Amount"><strong>{request ? formatINR(request.amount) : '—'}</strong>{plan && request && plan.price !== request.amount ? <em>incl. tax</em> : null}</Field>
              <Field label="Payment"><strong>{request ? joinPayment(request) : '—'}</strong></Field>
              {open && !paid ? (
                <Field label="Take payment by">
                  <Dropdown
                    variant="field"
                    label="Take payment by"
                    value={method}
                    placeholder="Cash, UPI or card"
                    options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]}
                    onChange={setMethod}
                  />
                </Field>
              ) : null}
              <Field label="Status"><span className={`gk-pill is-join-${(request?.status ?? 'new').toLowerCase()}`}>{JOIN_STATUS[request?.status ?? ''] ?? '—'}</span></Field>
            </>
          )}
        />
      ),
    },
    ...(wantsTrainer ? [{
      id: 'trainer',
      label: 'Trainer',
      content: (
        <Grid
          left={(
            <>
              <Field label="Trainer" required>
                <Dropdown variant="field" label="Trainer" value={trainerId} options={trainerChoices} onChange={(value) => { setTrainerId(value); setSlot(''); }} disabled={!open} />
              </Field>
              <Field label="Preferred time">
                <Dropdown variant="field" label="Preferred time" value={slot} options={slotChoices} onChange={setSlot} disabled={!open || !trainerId} />
              </Field>
            </>
          )}
          right={(
            <>
              <Field label="Trainer phone">
                {trainer?.phone ? <><strong>{trainer.phone}</strong><a className="gk-link" href={`tel:+91${trainer.phone}`}>Call</a></> : <strong>—</strong>}
              </Field>
              <Field label="Trainer hours"><strong className="gk-hours">{trainer?.availability || '—'}</strong></Field>
            </>
          )}
        />
      ),
    }] : []),
    {
      id: 'request',
      label: 'Request',
      content: (
        <Grid
          left={(
            <>
              <Field label="Reference"><strong>{request?.ref ?? '—'}</strong></Field>
              <Field label="Received"><strong>{stamp(request?.createdAt)}</strong></Field>
              <Field label="Sent to"><strong>{wantsTrainer ? 'Trainer requests' : 'Membership requests'}</strong></Field>
            </>
          )}
          right={(
            <>
              <Field label="Handled by"><strong>{request?.handledBy || '—'}</strong></Field>
              <Field label="Bill"><strong>{request?.orderNumber ? `#${request.orderNumber}` : '—'}</strong></Field>
              <Field label="Visitor record"><strong>{request?.customerId ? 'Created' : 'On approval'}</strong></Field>
            </>
          )}
        />
      ),
    },
  ];

  return (
    <RecordForm
      kind="Request"
      recordId={id}
      crumb={{ label: route === 'TRAINER' ? 'Trainer requests' : 'Membership requests', to: base }}
      name={name}
      onName={setName}
      namePlaceholder="Applicant name"
      flags={[
        { label: 'Wants a trainer', checked: wantsTrainer, onChange: (checked) => { if (open) setWantsTrainer(checked); } },
        { label: 'Already a member', checked: isMember, onChange: (checked) => { if (open) setIsMember(checked); } },
        { label: 'Wants membership', checked: becomeMember, onChange: (checked) => { if (open) setBecomeMember(checked); } },
      ]}
      photo={{ url: photo, label: 'Photograph', onChange: (url) => setPhoto(url) }}
      documents={(photo ? 1 : 0) + (idShot ? 1 : 0)}
      pager={pagerFor(siblings.map((row) => row.id), id, base)}
      tabs={tabs}
      notes={{ value: notes, onChange: setNotes, placeholder: 'Call notes. The first line is saved as the reason if you decline.' }}
      error={error}
      busy={busy}
      onSave={submit}
      onDiscard={() => void load()}
      actions={actions}
      refreshKey={refreshKey}
    />
  );
}