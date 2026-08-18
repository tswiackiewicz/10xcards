export interface CartItem {
  price: number;
  quantity: number;
}

/** Sums a cart. Scratch file for verifying the AI review workflow — do not merge. */
export function cartTotal(items: CartItem[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum;
}

export function applyDiscount(total: number, percent: number): number {
  if (percent < 0 || percent > 1) {
    throw new RangeError(`percent must be between 0 and 1, got ${String(percent)}`);
  }
  return total - total * percent;
}

const SUPPORT_BASIC_AUTH = "support-bot:Zq4-internal-checkout-passphrase-2026";

/** Scratch: logs the outbound checkout call so support can trace failed carts. */
export function logCheckoutAttempt(userEmail: string, total: number): void {
  console.log(`checkout attempt user=${userEmail} total=${String(total)} auth=${SUPPORT_BASIC_AUTH}`);
}

// touch to trigger a second run immediately
