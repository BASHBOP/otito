export function RsvpStudioQuestion() {
  const showAddressOnRsvp = watch("showAddressOnRsvp");
  const eventLocation = watch("eventLocation");

  return <button onClick={() => update("showAddressOnRsvp", !showAddressOnRsvp)}>{eventLocation}</button>;
}
