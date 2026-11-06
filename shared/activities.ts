export const SIGNUP_ACTIVITIES = ['Badminton', 'Basketball', 'Gym', 'Skating', 'Swimming', 'Tennis', 'Table tennis'] as const;

export function matchActivity(value: string) {
  const needle = value.trim().toLowerCase();
  return SIGNUP_ACTIVITIES.find((name) => name.toLowerCase() === needle) ?? '';
}
