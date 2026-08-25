/**
 * SERVICE - payment gateway boundary.
 *
 * Sandbox stub. Swap the body for ECPay/NewebPay: create the order as
 * `awaiting_payment`, redirect the buyer to the gateway, and let the gateway
 * callback flip it to `paid`. Card details never pass through this server.
 */
export const PaymentService = {
  async charge({ amountTwd, description }: { amountTwd: number; description: string }) {
    void amountTwd;
    void description;
    return { reference: `SANDBOX-${Date.now()}`, status: "paid" as const };
  },
};
