export function getValidHour(value: string) {
  const hours = Number(value);
  return hours >= 0 && hours < 24 ? hours : 0;
}

export function getValidMinute(value: string) {
  const minutes = Number(value);
  return minutes >= 0 && minutes < 60 ? minutes : 0;
}
