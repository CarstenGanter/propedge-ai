import { describe, expect, it } from "vitest";
import { NFL_STADIUMS, stadiumForTeam, venueMatchesStadium } from "./stadiums";

describe("NFL stadium table", () => {
  it("covers all 32 teams with valid coordinates and zones", () => {
    expect(NFL_STADIUMS).toHaveLength(32);
    expect(new Set(NFL_STADIUMS.map((s) => s.team)).size).toBe(32);
    for (const s of NFL_STADIUMS) {
      expect(s.lat).toBeGreaterThan(24);
      expect(s.lat).toBeLessThan(50);
      expect(s.lon).toBeLessThan(-70);
      expect(s.tz.startsWith("America/")).toBe(true);
    }
  });

  it("resolves Odds API / ESPN team names, including partial ones", () => {
    expect(stadiumForTeam("Green Bay Packers")?.roof).toBe("open");
    expect(stadiumForTeam("Detroit Lions")?.roof).toBe("dome");
    expect(stadiumForTeam("Dallas Cowboys")?.roof).toBe("retractable");
    expect(stadiumForTeam("Packers")?.venue).toBe("Lambeau Field");
  });

  it("detects neutral-site venues by name mismatch", () => {
    const kc = stadiumForTeam("Kansas City Chiefs")!;
    expect(venueMatchesStadium("GEHA Field at Arrowhead Stadium", kc)).toBe(true);
    expect(venueMatchesStadium("Arrowhead Stadium", kc)).toBe(true);
    expect(venueMatchesStadium("Wembley Stadium", kc)).toBe(false);
    expect(venueMatchesStadium("Allianz Arena", kc)).toBe(false);
    expect(venueMatchesStadium(null, kc)).toBe(true);
  });
});
