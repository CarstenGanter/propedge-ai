import { describe, expect, it } from "vitest";
import { aliasFor, PLAYER_ALIASES } from "./playerAliases";

describe("aliasFor", () => {
  it("maps the approved ESPN BET labels", () => {
    expect(aliasFor("Elijah Dotson")).toBe("Jahan Dotson");
    expect(aliasFor("Elerson G. Smith")).toBe("Geno Smith");
  });
  it("ignores case and a generational suffix", () => {
    expect(aliasFor("elijah dotson Jr.")).toBe("Jahan Dotson");
  });
  it("is null for a name not in the table", () => {
    expect(aliasFor("Jahan Dotson")).toBeNull();
  });
  it("records why each alias was approved", () => {
    for (const a of PLAYER_ALIASES) expect(a.note).toMatch(/Approved \d{4}-\d{2}-\d{2}/);
  });
});
