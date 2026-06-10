// Frontend API client that talks to shop-api's /orders route.
export async function createOrder(items: string[]) {
  return fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
}
