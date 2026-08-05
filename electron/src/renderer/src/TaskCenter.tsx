import { FolderOpen, Video, X } from "lucide-react";
import type { TranscodeProgress } from "../../shared/contracts";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";

export type UnifiedTask = {
  id: string;
  source: "媒体库" | "工具箱";
  name: string;
  detail: string;
  state: TranscodeProgress["state"];
  percent: number | null;
  speed: string | null;
  etaSeconds: number | null;
  createdAt?: string;
  queueOrder?: number;
  outputPath?: string;
  message?: string;
  cancel: () => Promise<void>;
  remove: () => Promise<void>;
};

type Notify = (message: string, error?: boolean) => void;

function taskErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stateRank(state: UnifiedTask["state"]): number {
  if (state === "running") return 0;
  if (state === "queued") return 1;
  return 2;
}

export function UnifiedTaskList({
  tasks,
  notify,
}: {
  tasks: UnifiedTask[];
  compact?: boolean;
  notify: Notify;
}) {
  const ordered = [...tasks].sort(
    (a, b) =>
      stateRank(a.state) - stateRank(b.state) ||
      (a.queueOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.queueOrder ?? Number.MAX_SAFE_INTEGER) ||
      (a.createdAt ?? a.id).localeCompare(b.createdAt ?? b.id),
  );

  if (!ordered.length) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-600">
        暂无 FFmpeg 任务
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ordered.map((task) => {
        const active = task.state === "running" || task.state === "queued";
        return (
          <article
            key={task.id}
            className="rounded-xl border border-white/8 bg-black/20 p-3"
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 rounded-lg p-2",
                  task.state === "running"
                    ? "bg-violet-500/15 text-violet-300"
                    : task.state === "queued"
                      ? "bg-amber-500/10 text-amber-300"
                      : task.state === "completed"
                        ? "bg-emerald-500/10 text-emerald-300"
                        : "bg-zinc-500/10 text-zinc-400",
                )}
              >
                <Video className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-200">
                    {task.name}
                  </span>
                  <Badge className="border-0 bg-white/5 text-[10px] text-zinc-400">
                    {task.source}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">{task.detail}</p>
                {active ? (
                  <>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-violet-400 transition-all"
                        style={{ width: `${task.percent ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-zinc-500">
                      {task.state === "queued"
                        ? "等待前方任务完成"
                        : `${task.percent?.toFixed(1) ?? 0}%${task.speed ? ` · ${task.speed}` : ""}${task.etaSeconds ? ` · 约 ${Math.ceil(task.etaSeconds)} 秒` : ""}`}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    {task.message ??
                      (task.state === "completed"
                        ? "已完成"
                        : task.state === "failed"
                          ? "任务失败"
                          : "已取消")}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {active ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void task.cancel().catch((error) =>
                        notify(taskErrorMessage(error), true),
                      )
                    }
                  >
                    终止
                  </Button>
                ) : (
                  <>
                    {task.state === "completed" && task.outputPath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="打开输出目录"
                        onClick={() =>
                          void window.avault
                            .revealToolOutput(task.outputPath!)
                            .catch((error) =>
                              notify(taskErrorMessage(error), true),
                            )
                        }
                      >
                        <FolderOpen className="size-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void task.remove().catch((error) =>
                          notify(taskErrorMessage(error), true),
                        )
                      }
                    >
                      移除
                    </Button>
                  </>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function TaskDrawer({
  open,
  onClose,
  onOpenTasks,
  tasks,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  onOpenTasks: () => void;
  tasks: UnifiedTask[];
  notify: Notify;
}) {
  if (!open) return null;
  const active = tasks.filter(
    (task) => task.state === "queued" || task.state === "running",
  );
  const history = tasks.filter(
    (task) => task.state !== "queued" && task.state !== "running",
  );

  return (
    <div
      className="fixed inset-0 z-[120]"
      role="dialog"
      aria-modal="true"
      aria-label="任务"
    >
      <button
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-label="关闭任务抽屉"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 right-0 flex w-[min(470px,94vw)] flex-col border-l border-white/10 bg-[#111216] shadow-2xl shadow-black/50">
        <header className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <h2 className="font-semibold">任务</h2>
            <p className="mt-1 text-xs text-zinc-600">
              媒体库与工具箱共用同一 FFmpeg 队列
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-300">进行中与等待中</h3>
            <Badge className="border-0 bg-violet-500/12 text-violet-300">
              {active.length} 项
            </Badge>
          </div>
          <UnifiedTaskList tasks={active} compact notify={notify} />
          {history.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-zinc-500">
                已结束任务（{history.length}）
              </summary>
              <div className="mt-3">
                <UnifiedTaskList tasks={history} compact notify={notify} />
              </div>
            </details>
          )}
        </div>
        <footer className="border-t border-white/8 p-4">
          <Button className="w-full" variant="secondary" onClick={onOpenTasks}>
            查看全部任务
          </Button>
        </footer>
      </aside>
    </div>
  );
}
