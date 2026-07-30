export function RsvpPage({ showAddressOnRsvp, eventLocation }) {
  return showAddressOnRsvp ? <p>{eventLocation}</p> : null;
}
