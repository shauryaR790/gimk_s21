export const GOVT_ID_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving licence', 'Voter ID'] as const;

export type GovtIdType = (typeof GOVT_ID_TYPES)[number];

const RULES: Record<GovtIdType, { pattern: RegExp; hint: string; error: string }> = {
  Aadhaar: { pattern: /^\d{12}$/, hint: '1234 5678 9012', error: 'Enter a valid 12-digit Aadhaar number.' },
  PAN: { pattern: /^[A-Z]{5}\d{4}[A-Z]$/, hint: 'ABCDE1234F', error: 'Enter a valid PAN (ABCDE1234F).' },
  Passport: { pattern: /^[A-Z][0-9]{7}$/, hint: 'A1234567', error: 'Enter a valid Indian passport number.' },
  'Driving licence': { pattern: /^[A-Z]{2}\d{13,14}$/, hint: 'MH1420110012345', error: 'Enter a valid driving licence number.' },
  'Voter ID': { pattern: /^[A-Z]{3}\d{7}$/, hint: 'ABC1234567', error: 'Enter a valid voter ID (ABC1234567).' },
};

export function govtIdHint(type: string) {
  const kind = GOVT_ID_TYPES.find((entry) => entry.toLowerCase() === type.trim().toLowerCase());
  return kind ? RULES[kind].hint : 'ID number';
}

export function normalizeGovtId(type: string, number: string) {
  const kind = GOVT_ID_TYPES.find((entry) => entry.toLowerCase() === type.trim().toLowerCase());
  if (!kind) return { error: 'Choose a valid ID type.' } as const;
  const raw = number.replace(/[\s-]/g, '').toUpperCase();
  if (!RULES[kind].pattern.test(raw)) return { error: RULES[kind].error } as const;
  const label = kind === 'Aadhaar' ? `Aadhaar · ending ${raw.slice(-4)}` : `${kind} · ${raw}`;
  return { type: kind, number: raw, label } as const;
}
