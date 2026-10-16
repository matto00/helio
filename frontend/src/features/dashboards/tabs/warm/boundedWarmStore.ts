import { serverNowMs } from "../serverClock";
import { WARM_ENTRY_MAX_BYTES, WARM_MAX, WARM_TTL_MS, WARM_WRITE_DEBOUNCE_MS } from "./warmConfig";
import { sanitizeEntry, warmKey, type WarmEntry, type WarmStore } from "./warmStore";

type EntryBuilder = () => WarmEntry | null;

/** D5: the single handle every warm read and write goes through. It carries an epoch, so a write that was
 *  queued or in flight when the user logged out (or another user signed in) is dropped; it bounds what is
 *  kept (1 MiB per entry, the 8 latest-viewed entries, the TTL); and it never returns another user's data. */
export class BoundedWarmStore {
  private epochValue = 0;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly raw: WarmStore,
    private readonly now: () => number = serverNowMs,
  ) {}

  get epoch(): number {
    return this.epochValue;
  }

  /** Debounced write of the entry `build()` returns when the timer fires (null = nothing to write). */
  scheduleWrite(userId: string, dashboardId: string, build: EntryBuilder): void {
    const key = warmKey(userId, dashboardId);
    const existing = this.timers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    const epoch = this.epochValue;
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        const entry = build();
        if (entry !== null) void this.write(entry, epoch);
      }, WARM_WRITE_DEBOUNCE_MS),
    );
  }

  /** Writes now. Aborts when the epoch moved on (logout / user change) since `epochAtStart`. */
  async write(entry: WarmEntry, epochAtStart: number = this.epochValue): Promise<boolean> {
    if (epochAtStart !== this.epochValue) return false;
    const clean = sanitizeEntry(entry);
    const key = warmKey(clean.userId, clean.dashboardId);
    try {
      if (JSON.stringify(clean).length > WARM_ENTRY_MAX_BYTES) {
        // Too large to keep: any older copy of it is stale by definition, so it goes too.
        await this.raw.delete(key);
        return false;
      }
      if (epochAtStart !== this.epochValue) return false;
      await this.raw.put(key, clean);
      if (epochAtStart !== this.epochValue) return false;
      await this.purgeUser(clean.userId, epochAtStart);
      return true;
    } catch {
      return false;
    }
  }

  async read(userId: string, dashboardId: string): Promise<WarmEntry | undefined> {
    try {
      const entry = await this.raw.get(warmKey(userId, dashboardId));
      return entry && entry.userId === userId && entry.v === 1 ? entry : undefined;
    } catch {
      return undefined;
    }
  }

  async remove(userId: string, dashboardId: string): Promise<void> {
    const key = warmKey(userId, dashboardId);
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    try {
      await this.raw.delete(key);
    } catch {
      // Best effort.
    }
  }

  /** Merge a newer `ownWriteAt` into the stored entry (D4: kept in sync after a tab was left). */
  async patchOwnWrite(userId: string, dashboardId: string, ownWriteAt: number): Promise<void> {
    const epoch = this.epochValue;
    const entry = await this.read(userId, dashboardId);
    if (!entry || (entry.ownWriteAt !== null && entry.ownWriteAt >= ownWriteAt)) return;
    await this.write({ ...entry, ownWriteAt }, epoch);
  }

  /** Deletes the user's stored entries `matches` says are affected (an Output / pipeline / source delete). */
  async removeWhere(userId: string, matches: (entry: WarmEntry) => boolean): Promise<void> {
    try {
      for (const { key, entry } of await this.raw.entries()) {
        if (entry?.userId === userId && matches(entry)) {
          const timer = this.timers.get(key);
          if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(key);
          }
          await this.raw.delete(key);
        }
      }
    } catch {
      // Best effort.
    }
  }

  /** Startup rule (D5): every entry that is not the signed-in user's is deleted. */
  async purgeOtherUsers(userId: string): Promise<void> {
    try {
      for (const { key, entry } of await this.raw.entries()) {
        if (!entry || entry.userId !== userId) await this.raw.delete(key);
      }
    } catch {
      // Best effort.
    }
  }

  /** After each write: drop TTL-expired entries, then everything beyond the 8 latest `lastViewedAt`. */
  private async purgeUser(userId: string, epochAtStart: number): Promise<void> {
    const mine = (await this.raw.entries()).filter(({ entry }) => entry?.userId === userId);
    const basis = (e: WarmEntry) => e.lastViewedAt ?? e.contentCapturedAt;
    const live = mine.filter(({ entry }) => this.now() - basis(entry) <= WARM_TTL_MS);
    const expired = mine.filter(({ entry }) => this.now() - basis(entry) > WARM_TTL_MS);
    live.sort((a, b) => basis(b.entry) - basis(a.entry));
    const victims = [...expired, ...live.slice(WARM_MAX)];
    for (const { key } of victims) {
      if (epochAtStart !== this.epochValue) return;
      await this.raw.delete(key);
    }
  }

  /** `clearWarmState` steps 1, 3, 4: bump the epoch and cancel every queued write, close the connection,
   *  then delete the database. In-flight writes see the new epoch and abort before `put`. */
  async clear(): Promise<void> {
    this.epochValue += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.raw.close();
    try {
      await this.raw.destroy();
    } catch {
      // Nothing more to do: the in-memory side is already empty.
    }
  }
}
