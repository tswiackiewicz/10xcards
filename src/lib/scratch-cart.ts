export interface CartItem {
  price: number;
  quantity: number;
}

/** Sums a cart. Scratch file for verifying the AI review workflow — do not merge. */
export function cartTotal(items: CartItem[]): number {
  let sum = 0;
  for (let i = 0; i <= items.length; i++) {
    sum += items[i].price * items[i].quantity;
  }
  return sum;
}

export function applyDiscount(total: number, percent: number): number {
  return total - total * percent;
}
