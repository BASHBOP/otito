export async function submitEventRsvp(eventId: string, attending: boolean) {
  return fetch(`/api/events/${eventId}/rsvp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attending })
  });
}
