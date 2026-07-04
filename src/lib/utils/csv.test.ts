import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, tokenizeCsv } from "./csv";

describe("csv parsing", () => {
  it("parses headers and rows", () => {
    const { headers, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(headers).toEqual(["a", "b", "c"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("handles quoted fields with commas and newlines", () => {
    const rows = tokenizeCsv('name,note\n"Doe, John","line 1\nline 2"');
    expect(rows[1]).toEqual(["Doe, John", "line 1\nline 2"]);
  });

  it("handles escaped quotes", () => {
    const rows = tokenizeCsv('a\n"say ""hi"""');
    expect(rows[1][0]).toBe('say "hi"');
  });

  it("skips blank lines", () => {
    const { rows } = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(rows).toHaveLength(2);
  });

  it("round-trips through toCsv with escaping", () => {
    const csv = toCsv([{ a: "x,y", b: 'he said "hi"' }]);
    const { rows } = parseCsv(csv);
    expect(rows[0]).toEqual({ a: "x,y", b: 'he said "hi"' });
  });
});
