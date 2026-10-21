import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
const { settledNote } = await import("./settle");

describe("settledNote", () => {
  it("keeps your note and adds automatic settlement's explanation after it", () => {
    expect(settledNote("tailed from X, 2u", { appendNote: "Graded 0 from nflverse snap counts." })).toBe("tailed from X, 2u\nGraded 0 from nflverse snap counts.");
    expect(settledNote(null, { appendNote: "Graded 0 from nflverse snap counts." })).toBe("Graded 0 from nflverse snap counts.");
  });

  it("lets the Settle dialog replace the note, since you edit it there", () => {
    expect(settledNote("old", { note: "edited in the dialog" })).toBe("edited in the dialog");
  });

  it("leaves the note alone when settlement says nothing", () => {
    expect(settledNote("tailed from X, 2u", {})).toBe("tailed from X, 2u");
  });
});
