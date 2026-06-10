// Money-flow surface: handles charging and refunding orders.
export class CheckoutService {
  charge(amount: number, currency: string) {
    return { amount, currency, status: "paid" };
  }

  refund(chargeId: string) {
    return { chargeId, status: "refunded" };
  }
}
