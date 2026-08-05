import { describe, expect, it } from "vitest";
import { pickNextFfmpegSource } from "./ffmpeg-task-queue";

describe("pickNextFfmpegSource", () => {
  it("returns null when the queue is empty", () => {
    expect(pickNextFfmpegSource([], [])).toBeNull();
  });

  it("ignores completed and cancelled tasks", () => {
    expect(
      pickNextFfmpegSource(
        [{ state: "completed", queueOrder: 1 }],
        [{ state: "queued", queueOrder: 2 }],
      ),
    ).toBe("tool");
  });

  it("chooses the earliest task across both task types", () => {
    expect(
      pickNextFfmpegSource(
        [{ state: "queued", queueOrder: 8 }],
        [{ state: "queued", queueOrder: 3 }],
      ),
    ).toBe("tool");
    expect(
      pickNextFfmpegSource(
        [{ state: "queued", queueOrder: 2 }],
        [{ state: "queued", queueOrder: 5 }],
      ),
    ).toBe("media");
  });

  it("keeps deterministic media-first behavior for legacy tasks", () => {
    expect(
      pickNextFfmpegSource(
        [{ state: "queued" }],
        [{ state: "queued" }],
      ),
    ).toBe("media");
  });
});
