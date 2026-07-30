function HostCard({ host }) {
  const bio = host.bio;
  return bio;
}

export function EventDetailScreen() {
  router.push({ pathname: "/rsvp/[eventId]" });
  return HostCard;
}
