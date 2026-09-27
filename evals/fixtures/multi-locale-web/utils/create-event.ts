export function combineDateAndTime(date: string, time: string, timeZone: string): Date {
  const localDateTime = `${date}T${time}`;
  return new Date(`${localDateTime}${timeZone === "UTC" ? "Z" : ""}`);
}

export function isStepValid(step: number): boolean {
  return step >= 0;
}
