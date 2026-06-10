// Stripe webhook receiver — part of the money-flow surface.
export function handleStripeWebhook(event: { type: string; id: string }) {
  return { received: true, type: event.type, id: event.id };
}
