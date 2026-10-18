import { describe, expect, it } from "vitest";
import { AnsRequest, DecimalStringSchema, Email, NewPassword, ProfileName, SettingsPatch } from "./index";

describe("contracts", () => {
  it("normalises email (trim, lower case) and rejects bad shapes", () => {
    expect(Email.parse("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(Email.safeParse("ana@example").success).toBe(false);
    expect(Email.safeParse("a".repeat(250) + "@x.io").success).toBe(false);
  });
  it("new password is 12..128 characters, never trimmed", () => {
    expect(NewPassword.safeParse("a".repeat(11)).success).toBe(false);
    expect(NewPassword.safeParse("a".repeat(12)).success).toBe(true);
    expect(NewPassword.safeParse("a".repeat(129)).success).toBe(false);
    expect(NewPassword.parse("  spaces kept  ")).toBe("  spaces kept  ");
  });
  it("profile names are trimmed, 1..40", () => {
    expect(ProfileName.parse("  Work ")).toBe("Work");
    expect(ProfileName.safeParse("   ").success).toBe(false);
    expect(ProfileName.safeParse("x".repeat(41)).success).toBe(false);
  });
  it("DecimalString accepts only the canonical form, max 48 chars (ADR 0008)", () => {
    for (const ok of ["1.5e-400", "0e+0", "-3.333333333333333333333333333333333e+0"]) {
      expect(DecimalStringSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["12.5", "1e10000", "Infinity", "1." + "1".repeat(34) + "e+0"]) {
      expect(DecimalStringSchema.safeParse(bad).success).toBe(false);
    }
    expect(AnsRequest.parse({ ans: null }).ans).toBeNull();
  });
  it("settings patch must not be empty", () => {
    expect(SettingsPatch.safeParse({}).success).toBe(false);
    expect(SettingsPatch.safeParse({ theme: "dark" }).success).toBe(true);
    expect(SettingsPatch.safeParse({ decimalPlaces: 13 }).success).toBe(false);
  });
});
