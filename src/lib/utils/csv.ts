// Minimal, dependency-free CSV parsing & serialization with RFC-4180 quote handling.

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Tokenize a CSV string into a matrix of cells, honoring quotes and escaped quotes. */
export function tokenizeCsv(input: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse CSV text into headers + keyed row objects, skipping blank lines. */
export function parseCsv(input: string): ParsedCsv {
  const matrix = tokenizeCsv(input.trim());
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = matrix[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    // skip fully-empty rows
    if (cells.every((c) => c.trim() === "")) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    rows.push(obj);
  }
  return { headers, rows };
}

function escapeCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize an array of objects to CSV text using the given (or inferred) columns. */
export function toCsv(
  records: Record<string, unknown>[],
  columns?: string[],
): string {
  if (records.length === 0) return columns ? columns.join(",") + "\n" : "";
  const cols = columns ?? Object.keys(records[0]);
  const lines = [cols.join(",")];
  for (const rec of records) {
    const line = cols
      .map((c) => {
        const v = rec[c];
        return escapeCell(v === null || v === undefined ? "" : String(v));
      })
      .join(",");
    lines.push(line);
  }
  return lines.join("\n") + "\n";
}
