/** Phone numbers are stored in E.164; Indian mobiles may be typed the usual ways. */
import { describe, expect, it } from "vitest";
import { phoneSchema, toE164 } from "../src/shared";

describe("toE164", () => {
  it("normalises the ways an Indian mobile number is typed", () => {
    for (const typed of ["9876543210", "09876543210", "919876543210", "+919876543210", "+91 98765 43210", "98765-43210", "(+91) 98765 43210", "0091 98765 43210"]) {
      expect(toE164(typed), typed).toBe("+919876543210");
    }
  });

  it("keeps other countries' E.164 numbers", () => {
    expect(toE164("+44 7700 900017")).toBe("+447700900017");
    expect(toE164("+1 202 555 0143")).toBe("+12025550143");
  });

  it("refuses what is not a phone number", () => {
    for (const typed of ["", "12345", "phone", "+91 12345 67890", "5876543210", "+0123456789", "+1234567890123456", "98765432101"]) {
      expect(toE164(typed), typed).toBeNull();
    }
  });

  it("the booking schema stores the E.164 form", () => {
    expect(phoneSchema.parse(" 98765 43210 ")).toBe("+919876543210");
    expect(phoneSchema.safeParse("12345").success).toBe(false);
  });
});
