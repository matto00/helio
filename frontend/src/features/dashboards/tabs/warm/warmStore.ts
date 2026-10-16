// HEL-1575 D5: the browser-stored copy of warm dashboards, behind a small interface so the real
// IndexedDB path (proved by e2e) and the in-memory adapter (unit tests, private mode) are
// interchangeable. No new dependency.

import type { Output } from "../../../pipelines/types/output";
import type { Panel, PanelLastQuery } from "../../../panels/types/panel";

/** The settled-window fields that are stored (an explicit allow-list: nothing else is ever persisted). */
export interface StoredWindow {
  currentPage: number;
  hasMore: boolean;
  rows: Record<string, unknown>[];
  materialized: boolean;
  total: number;
  metric?: unknown;
  lastQuery?: PanelLastQuery;
  generation?: number;
  /** Server-time epoch ms at the start of the window's latest page-0 request. */
  capturedAt: number;
}

/** One stored dashboard. All instants are server-time epoch ms. */
export interface WarmEntry {
  v: 1;
  userId: string;
  dashboardId: string;
  contentCapturedAt: number;
  ownWriteAt: number | null;
  lastViewedAt: number | null;
  panels: Panel[];
  rows: Record<string, StoredWindow>;
  outputMeta: Record<string, Output>;
  runBaseline: Record<string, string>;
}

/** The only keys an entry may carry (asserted by a unit test; no session, token, link or header). */
export const WARM_ENTRY_KEYS = [
  "v",
  "userId",
  "dashboardId",
  "contentCapturedAt",
  "ownWriteAt",
  "lastViewedAt",
  "panels",
  "rows",
  "outputMeta",
  "runBaseline",
] as const;

export const WARM_WINDOW_KEYS = [
  "currentPage",
  "hasMore",
  "rows",
  "materialized",
  "total",
  "metric",
  "lastQuery",
  "generation",
  "capturedAt",
] as const;

/** Rebuilds `entry` from the allow-list only, so an unexpected field can never reach storage. */
export function sanitizeEntry(entry: WarmEntry): WarmEntry {
  const rows: Record<string, StoredWindow> = {};
  for (const [panelId, window] of Object.entries(entry.rows)) {
    const clean: Record<string, unknown> = {};
    for (const key of WARM_WINDOW_KEYS) {
      if (window[key] !== undefined) clean[key] = window[key];
    }
    rows[panelId] = clean as unknown as StoredWindow;
  }
  return {
    v: 1,
    userId: entry.userId,
    dashboardId: entry.dashboardId,
    contentCapturedAt: entry.contentCapturedAt,
    ownWriteAt: entry.ownWriteAt,
    lastViewedAt: entry.lastViewedAt,
    panels: entry.panels,
    rows,
    outputMeta: entry.outputMeta,
    runBaseline: entry.runBaseline,
  };
}

export function warmKey(userId: string, dashboardId: string): string {
  return `${userId}:${dashboardId}`;
}

/** Raw storage. Bounds, TTL and user isolation are enforced by `BoundedWarmStore` on top. */
export interface WarmStore {
  get(key: string): Promise<WarmEntry | undefined>;
  put(key: string, entry: WarmEntry): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every stored entry with its key. */
  entries(): Promise<Array<{ key: string; entry: WarmEntry }>>;
  /** Releases the open connection (a no-op for the memory adapter). */
  close(): void;
  /** Removes the whole database. Callers `close()` first. */
  destroy(): Promise<void>;
}

export class MemoryWarmStore implements WarmStore {
  private readonly map = new Map<string, WarmEntry>();

  async get(key: string): Promise<WarmEntry | undefined> {
    const entry = this.map.get(key);
    return entry ? (JSON.parse(JSON.stringify(entry)) as WarmEntry) : undefined;
  }

  async put(key: string, entry: WarmEntry): Promise<void> {
    this.map.set(key, JSON.parse(JSON.stringify(entry)) as WarmEntry);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async entries(): Promise<Array<{ key: string; entry: WarmEntry }>> {
    return [...this.map.entries()].map(([key, entry]) => ({
      key,
      entry: JSON.parse(JSON.stringify(entry)) as WarmEntry,
    }));
  }

  close(): void {}

  async destroy(): Promise<void> {
    this.map.clear();
  }
}

export const WARM_DB_NAME = "helio-warm";
const STORE_NAME = "entries";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB adapter: database `helio-warm` v1, object store `entries`, out-of-line key `${userId}:${dashboardId}`. */
export class IndexedDbWarmStore implements WarmStore {
  private db: Promise<IDBDatabase> | null = null;
  private opened: IDBDatabase | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    if (this.db === null) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(WARM_DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => {
          this.opened = req.result;
          resolve(req.result);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("helio-warm open blocked"));
      });
      this.db.catch(() => {
        this.db = null;
      });
    }
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async get(key: string): Promise<WarmEntry | undefined> {
    return (await request((await this.store("readonly")).get(key))) as WarmEntry | undefined;
  }

  async put(key: string, entry: WarmEntry): Promise<void> {
    await request((await this.store("readwrite")).put(entry, key));
  }

  async delete(key: string): Promise<void> {
    await request((await this.store("readwrite")).delete(key));
  }

  async entries(): Promise<Array<{ key: string; entry: WarmEntry }>> {
    const store = await this.store("readonly");
    const [keys, values] = await Promise.all([
      request(store.getAllKeys()),
      request(store.getAll()),
    ]);
    return keys.map((key, index) => ({ key: String(key), entry: values[index] as WarmEntry }));
  }

  close(): void {
    this.opened?.close();
    this.opened = null;
    this.db = null;
  }

  destroy(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.factory.deleteDatabase(WARM_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }
}

/** The adapter for this browser: IndexedDB when present, else memory only (private mode, test env). */
export function createDefaultWarmStore(): WarmStore {
  try {
    if (typeof indexedDB !== "undefined" && indexedDB !== null) {
      return new IndexedDbWarmStore(indexedDB);
    }
  } catch {
    // Some browsers throw on access in private mode.
  }
  return new MemoryWarmStore();
}
