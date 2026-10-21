import { describe, expect, it } from "vitest";
import { baseNameOf, nameMatch, pickByName } from "./playerName";

describe("generational suffixes", () => {
  it("are ignored when comparing names", () => {
    expect(baseNameOf("Travis Etienne Jr.")).toBe("travis etienne");
    expect(nameMatch("Travis Etienne Jr.", "Travis Etienne")).toBe(true);
    expect(nameMatch("Marvin Harrison Jr.", "M. Harrison")).toBe(true);
  });

  it("no longer make two different 'Jr.' players with the same initial match", () => {
    expect(nameMatch("Michael Pittman Jr.", "Marvin Harrison Jr.")).toBe(false);
  });
});

describe("pickByName", () => {
  const props = [{ playerName: "Marvin Harrison Jr." }, { playerName: "Michael Harrison" }, { playerName: "Trey McBride" }];
  const name = (p: { playerName: string }) => p.playerName;

  it("prefers the exact name over a surname-and-initial lookalike", () => {
    expect(pickByName(props, "Marvin Harrison", name)?.playerName).toBe("Marvin Harrison Jr.");
    expect(pickByName(props, "Michael Harrison", name)?.playerName).toBe("Michael Harrison");
  });

  it("takes a loose match only when it is the only one", () => {
    expect(pickByName(props, "T. McBride", name)?.playerName).toBe("Trey McBride");
    expect(pickByName(props, "M. Harrison", name)).toBeNull(); // two candidates
    expect(pickByName(props, "Nobody", name)).toBeNull();
  });
});
