export const TASK_CATEGORIES = ['Repair', 'Cleaning', 'Inspection', 'Equipment', 'Electrical', 'Plumbing', 'Safety'] as const;

export const TASK_PRIORITIES = [
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Low' },
] as const;

export function priorityLabel(value: string) {
  return TASK_PRIORITIES.find((row) => row.value === value)?.label ?? 'Normal';
}
