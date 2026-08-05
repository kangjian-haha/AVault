export type FfmpegQueueSource = "media" | "tool";

export type QueuedFfmpegTask = {
  state: string;
  queueOrder?: number;
};

export function pickNextFfmpegSource(
  mediaTasks: readonly QueuedFfmpegTask[],
  toolTasks: readonly QueuedFfmpegTask[],
): FfmpegQueueSource | null {
  const mediaTask = mediaTasks.find((task) => task.state === "queued");
  const toolTask = toolTasks.find((task) => task.state === "queued");
  if (!mediaTask) return toolTask ? "tool" : null;
  if (!toolTask) return "media";

  const mediaOrder = mediaTask.queueOrder ?? Number.MAX_SAFE_INTEGER;
  const toolOrder = toolTask.queueOrder ?? Number.MAX_SAFE_INTEGER;
  return mediaOrder <= toolOrder ? "media" : "tool";
}
