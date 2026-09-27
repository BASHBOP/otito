const combineDateAndTime = (date: string, time: string) => new Date(`${date}T${time}`);

export function normalizeAiEventDataForCreation(input: { date: string; startTime: string; endTime: string }) {
  return { startTime: combineDateAndTime(input.date, input.startTime), endTime: combineDateAndTime(input.date, input.endTime) };
}
