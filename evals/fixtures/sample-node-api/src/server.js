export function createServer() {
  return {
    routes: ["/health", "/events/:id/rsvp"],
  };
}
