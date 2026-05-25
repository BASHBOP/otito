import { EventsController } from "../src/events/events.controller";

test("submits an RSVP", () => {
  const controller = new EventsController();
  expect(controller.submitRsvp("event_123", { attending: true })).toEqual({
    eventId: "event_123",
    attending: true
  });
});
