import { combineDateAndTime } from "@/utils/create-event";

export interface CreateEventOptions {
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
}

export class EventService {
  createOrUpdateEvent(options: CreateEventOptions) {
    const start = combineDateAndTime(options.date, options.startTime, options.timeZone);
    const end = combineDateAndTime(options.date, options.endTime, options.timeZone);
    if (end.getHours() < start.getHours()) throw new Error("end before start");
    return { start, end };
  }
}
