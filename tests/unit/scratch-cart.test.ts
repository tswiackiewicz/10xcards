import { describe, expect, it } from "vitest";

import { applyDiscount, cartTotal } from "@/lib/scratch-cart";

describe("cartTotal", () => {
  it("sums price times quantity across every item", () => {
    expect(cartTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }])).toBe(25);
  });

  it("returns 0 for an empty cart", () => {
    expect(cartTotal([])).toBe(0);
  });
});

describe("applyDiscount", () => {
  it("subtracts the percentage from the total", () => {
    expect(applyDiscount(100, 0.25)).toBe(75);
  });

  it("rejects a percent outside 0..1", () => {
    expect(() => applyDiscount(100, 1.5)).toThrow(RangeError);
  });
});
