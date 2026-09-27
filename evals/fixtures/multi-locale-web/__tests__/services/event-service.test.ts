import { EventService } from "@/services/event-service";

test("createOrUpdateEvent rejects an end time before the start time", () => {
  expect(() => new EventService().createOrUpdateEvent({ date: "2026-09-27", startTime: "22:00", endTime: "02:00", timeZone: "UTC" })).toThrow();
});
