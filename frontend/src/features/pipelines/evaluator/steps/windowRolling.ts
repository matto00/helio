// HEL-1581 — rolling window frames (port of `WindowRolling.scala`): row frames and day frames, with exact sums.

import { epochDayOf } from "../instants";
import { javaSort } from "../javaTimSort";
import { cell, int, type Row, type Value } from "../value";
import { parseInstantCell } from "./cast";
import { fromScaled, toScaled } from "./exactSum";
import { toDouble } from "./numeric";
import { rowOrdering, type Indexed, type WindowConfig } from "./windowShared";

const finiteNumeric = (row: Row, field: string): number | undefined => {
  const d = toDouble(cell(row, field));
  return d !== undefined && Number.isFinite(d) ? d : undefined;
};

function slideFrames(
  fn: string,
  values: ReadonlyArray<number | undefined>,
  ranges: ReadonlyArray<[number, number]>,
): Value[] {
  let added = -1;
  let removed = 0;
  let sum = 0n;
  let count = 0;
  const deque: number[] = [];
  let head = 0;
  const wantMin = fn === "rolling_min";
  const wantMax = fn === "rolling_max";
  return ranges.map(([start, end]): Value => {
    while (added < end) {
      added += 1;
      const v = values[added];
      if (v === undefined) continue;
      sum += toScaled(v);
      count += 1;
      if (wantMin) {
        while (deque.length > head && values[deque[deque.length - 1]]! >= v) deque.pop();
        deque.push(added);
      }
      if (wantMax) {
        while (deque.length > head && values[deque[deque.length - 1]]! <= v) deque.pop();
        deque.push(added);
      }
    }
    while (removed < start) {
      const v = values[removed];
      if (v !== undefined) {
        sum -= toScaled(v);
        count -= 1;
        if (deque.length > head && deque[head] === removed) head += 1;
      }
      removed += 1;
    }
    if (fn === "rolling_count") return int(count);
    if (count === 0) return null;
    if (fn === "rolling_sum") return fromScaled(sum);
    if (fn === "rolling_avg") return fromScaled(sum) / count;
    return values[deque[head]]!;
  });
}

export function rollingForPartition(
  group: Indexed[],
  cfg: WindowConfig,
  field: string,
  out: Value[],
): void {
  const size = cfg.frameSize!;
  if (cfg.frameUnit === "days") {
    const key = cfg.orderBy[0].field;
    const dated = group
      .flatMap(({ row, idx }) => {
        const instant = parseInstantCell(cell(row, key));
        return instant ? [{ day: epochDayOf(instant.seconds), row, idx }] : [];
      })
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.idx - b.idx));
    const dates = dated.map((d) => d.day);
    const values = dated.map((d) => finiteNumeric(d.row, field));
    const lastPeer = new Array<number>(dates.length);
    for (let i = dates.length - 1; i >= 0; i--) {
      lastPeer[i] = i + 1 < dates.length && dates[i + 1] === dates[i] ? lastPeer[i + 1] : i;
    }
    let start = 0;
    const ranges = dates.map((_d, p): [number, number] => {
      while (dates[start] < dates[p] - BigInt(size - 1)) start += 1;
      return [start, lastPeer[p]];
    });
    const framed = slideFrames(cfg.function, values, ranges);
    for (const { idx } of group) out[idx] = null;
    dated.forEach((d, i) => {
      out[d.idx] = framed[i];
    });
    return;
  }
  const sorted = javaSort(group, rowOrdering(cfg.orderBy));
  const values = sorted.map(({ row }) => finiteNumeric(row, field));
  const ranges = values.map((_v, p): [number, number] => [Math.max(0, p - size + 1), p]);
  const framed = slideFrames(cfg.function, values, ranges);
  sorted.forEach(({ idx }, i) => {
    out[idx] = framed[i];
  });
}
