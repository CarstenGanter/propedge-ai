/**
 * The slice of Node's built-in `node:sqlite` (Node 22.5+; this project runs on
 * Node 24) that the database backup uses. @types/node is pinned at 20, which
 * predates the module.
 */
declare module "node:sqlite" {
  interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
