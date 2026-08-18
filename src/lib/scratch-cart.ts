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
