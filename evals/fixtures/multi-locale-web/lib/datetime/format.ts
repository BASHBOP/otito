export function formatEventDate(value: string): string {
  return new Date(value).toISOString();
}

export function formatTimeRange(start: string, end: string): string {
  return `${start} - ${end}`;
}
