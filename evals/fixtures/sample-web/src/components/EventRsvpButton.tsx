import { submitEventRsvp } from "../api/events";

export function EventRsvpButton({ eventId }: { eventId: string }) {
  return <button onClick={() => submitEventRsvp(eventId, true)}>RSVP</button>;
}
