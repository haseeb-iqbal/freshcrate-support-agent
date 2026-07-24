import { describe, expect, it } from "vitest";
import { money } from "./money";

describe("money", () => {
  it("drops the decimals entirely for a whole number of dollars", () => {
    expect(money(800)).toBe("$8");
    expect(money(4400)).toBe("$44");
    expect(money(12000)).toBe("$120");
  });

  it("keeps BOTH decimals whenever there are cents, including a trailing zero", () => {
    expect(money(1750)).toBe("$17.50");
    expect(money(1725)).toBe("$17.25");
    expect(money(4299)).toBe("$42.99");
    expect(money(105)).toBe("$1.05");
  });

  it("formats zero as a bare dollar amount", () => {
    expect(money(0)).toBe("$0");
  });

  it("does not leak binary floating-point noise", () => {
    // 1015 / 100 is 10.149999999999999 in IEEE 754; it must still read as $10.15.
    expect(money(1015)).toBe("$10.15");
    expect(money(2903)).toBe("$29.03");
  });

  it("keeps the sign on a negative amount", () => {
    expect(money(-4400)).toBe("$-44");
  });
});
