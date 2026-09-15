import { describe, expect, it } from "vitest";
import { bucketFor, signedEdge, summarizeLineEdge, type LineEdgeInput } from "./lineEdge";

const row = (
  underdogLine: number,
  marketLine: number,
  direction: "OVER" | "UNDER",
  status: LineEdgeInput["status"] = "pending",
): LineEdgeInput => ({ underdogLine, marketLine, direction, status, propType: "Receptions" });

describe("signedEdge", () => {
  it("is positive when the played line is easier to beat", () => {
    expect(signedEdge(row(4.0, 4.5, "OVER"))).toBeCloseTo(0.5, 9); // lower line helps an OVER
    expect(signedEdge(row(5.0, 4.5, "UNDER"))).toBeCloseTo(0.5, 9); // higher line helps an UNDER
  });

  it("is negative when the played line is tougher", () => {
    expect(signedEdge(row(5.0, 4.5, "OVER"))).toBeCloseTo(-0.5, 9);
    expect(signedEdge(row(4.0, 4.5, "UNDER"))).toBeCloseTo(-0.5, 9);
  });

  it("is zero when the lines match, on either side", () => {
    expect(signedEdge(row(4.5, 4.5, "OVER"))).toBe(0);
    expect(signedEdge(row(4.5, 4.5, "UNDER"))).toBe(-0);
  });
});

describe("bucketFor", () => {
  it("treats a vanishing difference as identical", () => {
    expect(bucketFor(0)).toBe("identical");
    expect(bucketFor(-0)).toBe("identical");
    expect(bucketFor(0.0000001)).toBe("identical");
    expect(bucketFor(0.5)).toBe("softer");
    expect(bucketFor(-0.5)).toBe("tougher");
  });
});

describe("summarizeLineEdge", () => {
  it("counts how often the pick'em line matched the book", () => {
    const s = summarizeLineEdge([
      row(4.5, 4.5, "OVER"),
      row(4.5, 4.5, "UNDER"),
      row(4.0, 4.5, "OVER"),
      row(5.0, 4.5, "OVER"),
    ]);
    expect(s.total).toBe(4);
    expect(s.buckets.identical.count).toBe(2);
    expect(s.buckets.softer.count).toBe(1);
    expect(s.buckets.tougher.count).toBe(1);
    expect(s.identicalShare).toBeCloseTo(0.5, 9);
  });

  it("scores each bucket separately so a favourable line can be tested", () => {
    const s = summarizeLineEdge([
      row(4.0, 4.5, "OVER", "hit"),
      row(4.0, 4.5, "OVER", "hit"),
      row(4.0, 4.5, "OVER", "miss"),
      row(4.5, 4.5, "OVER", "miss"),
      row(4.5, 4.5, "OVER", "miss"),
    ]);
    expect(s.buckets.softer.hits).toBe(2);
    expect(s.buckets.softer.hitRate).toBeCloseTo(66.7, 1);
    expect(s.buckets.identical.hitRate).toBe(0);
  });

  it("ignores pushes and pending picks in the hit rate", () => {
    const s = summarizeLineEdge([
      row(4.0, 4.5, "OVER", "hit"),
      row(4.0, 4.5, "OVER", "push"),
      row(4.0, 4.5, "OVER", "pending"),
    ]);
    expect(s.buckets.softer.count).toBe(3);
    expect(s.buckets.softer.hitRate).toBe(100);
  });

  it("averages the signed edge across every recorded prop", () => {
    const s = summarizeLineEdge([row(4.0, 4.5, "OVER"), row(5.0, 4.5, "OVER"), row(4.5, 4.5, "OVER")]);
    expect(s.averageEdge).toBeCloseTo(0, 9);
  });

  it("refuses to call itself conclusive on a small sample", () => {
    const few = summarizeLineEdge([row(4.0, 4.5, "OVER", "hit"), row(4.5, 4.5, "OVER", "miss")]);
    expect(few.conclusive).toBe(false);

    const many = [
      ...Array.from({ length: 20 }, () => row(4.0, 4.5, "OVER", "hit")),
      ...Array.from({ length: 20 }, () => row(4.5, 4.5, "OVER", "miss")),
    ];
    expect(summarizeLineEdge(many).conclusive).toBe(true);
  });

  it("handles an empty history without dividing by zero", () => {
    const s = summarizeLineEdge([]);
    expect(s.total).toBe(0);
    expect(s.identicalShare).toBeNull();
    expect(s.averageEdge).toBeNull();
    expect(s.conclusive).toBe(false);
  });
});
