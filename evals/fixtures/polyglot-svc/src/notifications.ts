// Notification dispatch (TypeScript). Distinct domain from users/inventory.
export function sendNotification(userId: string, message: string) {
  return { userId, message, sent: true };
}
