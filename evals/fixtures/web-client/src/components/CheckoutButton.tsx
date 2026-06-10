import { createOrder } from "../api/orders";

export function CheckoutButton({ items }: { items: string[] }) {
  return <button onClick={() => createOrder(items)}>Checkout</button>;
}
