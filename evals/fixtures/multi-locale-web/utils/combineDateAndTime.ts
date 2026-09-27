export function combineDateAndTime(date: string, time: string): string {
  const dt = `${date}T${time}`;
  return dt;
}
