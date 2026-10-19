import { pushDragSample, velocityOf, VELOCITY_WINDOW, type DragSample } from "./dragVelocity";

describe("dragVelocity", () => {
  it("is 0 with fewer than two samples or no elapsed time", () => {
    expect(velocityOf([])).toBe(0);
    expect(velocityOf([{ t: 5, y: 10 }])).toBe(0);
    expect(
      velocityOf([
        { t: 5, y: 10 },
        { t: 5, y: 50 },
      ]),
    ).toBe(0);
  });

  it("is px per millisecond, positive downward and negative upward", () => {
    expect(
      velocityOf([
        { t: 0, y: 0 },
        { t: 20, y: 30 },
      ]),
    ).toBeCloseTo(1.5);
    expect(
      velocityOf([
        { t: 0, y: 30 },
        { t: 10, y: 20 },
      ]),
    ).toBeCloseTo(-1);
  });

  it("keeps only the recent window, so an early slow stretch does not dilute a late flick", () => {
    const samples: DragSample[] = [];
    pushDragSample(samples, { t: 0, y: 0 });
    pushDragSample(samples, { t: VELOCITY_WINDOW * 3, y: 10 });
    pushDragSample(samples, { t: VELOCITY_WINDOW * 3 + 10, y: 40 });
    expect(samples[0].t).toBe(VELOCITY_WINDOW * 3);
    expect(velocityOf(samples)).toBeCloseTo(3);
  });

  it("always retains two samples even when both are older than the window", () => {
    const samples: DragSample[] = [{ t: 0, y: 0 }];
    pushDragSample(samples, { t: VELOCITY_WINDOW * 5, y: 10 });
    expect(samples).toHaveLength(2);
  });
});
