import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import appIcon from "./assets/avault-icon.png";
import {
  Archive,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Clapperboard,
  Clock3,
  Eye,
  Copy,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Images,
  List,
  LoaderCircle,
  MonitorSmartphone,
  MoreHorizontal,
  Minus,
  Play,
  Plus,
  Pencil,
  RectangleHorizontal,
  RectangleVertical,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Unplug,
  Users,
  Video,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";
import type {
  ActorProfile,
  ActorProfilePatch,
  AiUsageStats,
  AppLogEntry,
  AppSnapshot,
  LibraryRecord,
  MetadataBatchProgress,
  MetadataCandidate,
  MetadataDetails,
  SourcePartition,
  MoviePatch,
  MovieRecord,
  OrganizePreview,
  OrganizeProgress,
  PairingDisplay,
  ScanProgress,
  TranscodeKind,
  TranscodeProgress,
  ToolEncodeOptions,
  ToolFile,
  ToolTask,
  WatchStatus,
} from "../../shared/contracts";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input, Textarea } from "./components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { cn, formatBytes, formatDate } from "./lib/utils";
import { IndependentToolsPage } from './ToolboxPage';

type Section =
  | "all"
  | "uncrawled"
  | "unidentified"
  | "actors"
  | "tasks"
  | "ai"
  | "logs"
  | "tools"
  | "devices"
  | "settings"
  | `library:${string}`;
type SortMode =
  | "added-desc"
  | "added-asc"
  | "release-desc"
  | "release-asc"
  | "code-asc"
  | "title-asc";
type GridCoverMode = "landscape" | "portrait";

function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message.replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    );
  return "操作失败，请稍后再试";
}

function ageFromBirthday(birthday: string | null | undefined): string {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return "未知";
  const [year, month, day] = birthday.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day)
  )
    age -= 1;
  return age >= 0 && age < 120 ? `${age} 岁` : "未知";
}

function mediaSummary(file: MovieRecord["files"][number]): string {
  const info = file.mediaInfo;
  if (!info) return "正在分析媒体参数…";
  const resolution =
    info.width && info.height ? `${info.width}×${info.height}` : null;
  const rate = info.frameRate ? `${info.frameRate} fps` : null;
  const video = [
    info.videoCodec?.toUpperCase(),
    resolution,
    rate,
    info.videoBitrate
      ? `${Math.round((info.videoBitrate / 1_000_000) * 10) / 10} Mbps`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const audio = [
    info.audioCodec?.toUpperCase(),
    info.audioChannels ? `${info.audioChannels} 声道` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return [video, audio].filter(Boolean).join(" / ") || "未检测到媒体流";
}

function Cover({
  movie,
  className,
}: {
  movie: MovieRecord;
  className?: string;
}) {
  if (movie.coverUrl)
    return (
      <img
        src={movie.coverUrl}
        alt={movie.title}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  return (
    <div
      className={cn(
        "poster-gradient flex h-full w-full flex-col items-center justify-center gap-3 text-zinc-500",
        className,
      )}
    >
      <Clapperboard className="size-10 text-violet-400/55" />
      <span className="max-w-[80%] truncate text-xs tracking-wider">
        {movie.code ?? "未识别"}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: WatchStatus }) {
  const map = {
    unwatched: ["未观看", "bg-zinc-500/10 text-zinc-400"],
    watching: ["观看中", "bg-amber-500/12 text-amber-300"],
    watched: ["已看完", "bg-emerald-500/12 text-emerald-300"],
  } as const;
  return (
    <Badge className={cn("border-0", map[status][1])}>{map[status][0]}</Badge>
  );
}

function hasMovieMetadata(movie: MovieRecord): boolean {
  const title = movie.title.trim().toUpperCase();
  const codes = [movie.code, movie.normalizedCode]
    .filter((code): code is string => Boolean(code))
    .map((code) => code.trim().toUpperCase());
  const hasMeaningfulTitle = Boolean(title) && !codes.includes(title);
  return Boolean(
    movie.metadataSource ||
      hasMeaningfulTitle ||
      movie.releaseDate ||
      movie.durationMinutes ||
      movie.director ||
      movie.studio ||
      movie.label ||
      movie.series ||
      movie.description.trim() ||
      movie.actors.length ||
      movie.tags.length,
  );
}

function MovieCard({
  movie,
  mode,
  coverMode,
  onOpen,
  onPlay,
}: {
  movie: MovieRecord;
  mode: "grid" | "list";
  coverMode: GridCoverMode;
  onOpen: () => void;
  onPlay?: () => void;
}) {
  const available = movie.files.filter((file) => file.available).length;
  if (mode === "list") {
    const sourcePartitionLabel = {
      censored: "有码",
      fc2: "FC2",
      uncensored: "无码",
      leaked: "流出",
      unknown: "待分类",
    }[movie.sourcePartition];
    return (
      <button
        onClick={onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          void window.avault.showMovieContextMenu(movie.id);
        }}
        className="group flex w-full items-center gap-4 rounded-2xl border border-white/[0.055] bg-transparent p-3 text-left transition hover:border-violet-400/20 hover:bg-white/[0.035]"
      >
        <div className="aspect-[840/568] w-40 shrink-0 overflow-hidden rounded-xl bg-zinc-900 shadow-lg shadow-black/20">
          <Cover movie={movie} />
        </div>
        <div className="flex h-[108px] min-w-0 flex-1 flex-col justify-between py-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-100">
              {movie.code ?? "未识别"}
            </span>
            <StatusBadge status={movie.watchStatus} />
            <span className="ml-1 flex shrink-0 items-center gap-1 text-xs text-zinc-500">
              <Clock3 className="size-3" />
              {movie.releaseDate ?? "发行未知"}
            </span>
          </div>
          <p className="line-clamp-2 pr-5 text-sm leading-5 text-zinc-300">{movie.title}</p>
          <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-600">
            <span className="max-w-[36%] truncate">{movie.actors.length ? movie.actors.slice(0, 2).join("、") : "演员未知"}</span>
            <span className="h-3 w-px shrink-0 bg-white/10" />
            <span className="shrink-0">{movie.durationMinutes ? `${movie.durationMinutes} 分钟` : "时长未知"}</span>
            <Badge className="border-violet-400/15 bg-violet-500/[0.07] px-1.5 py-0 text-[10px] font-normal text-violet-200">
              {sourcePartitionLabel}
            </Badge>
            <span className="truncate">{available}/{movie.files.length} 个文件可用</span>
          </div>
        </div>
        <MoreHorizontal className="mr-1 size-5 shrink-0 text-zinc-600 transition group-hover:text-zinc-300" />
      </button>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        void window.avault.showMovieContextMenu(movie.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group min-w-0 cursor-pointer text-left"
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-900 shadow-lg shadow-black/10 transition duration-200 group-hover:-translate-y-1 group-hover:border-violet-400/30 group-hover:shadow-violet-950/25",
          coverMode === "portrait" ? "aspect-[442/568]" : "aspect-[840/568]",
        )}
      >
        <Cover
          movie={movie}
          className={coverMode === "portrait" ? "object-right" : undefined}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent p-3 pt-10 opacity-0 transition group-hover:opacity-100">
          <span className="text-xs text-zinc-300">{available} 个文件</span>
          <button
            type="button"
            aria-label={`播放 ${movie.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onPlay?.();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="rounded-full bg-violet-600 p-2 text-white transition hover:bg-violet-500"
          >
            <Play className="size-4 fill-current" />
          </button>
        </div>
        {!hasMovieMetadata(movie) && (
          <Badge className="absolute left-2 top-2 border-black/10 bg-black/55 text-zinc-300 backdrop-blur">
            未获取资料
          </Badge>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">
            {movie.code ?? "未识别番号"}
          </div>
          {coverMode !== "portrait" && (
            <div className="mt-1 truncate text-xs text-zinc-500">
              {movie.title}
            </div>
          )}
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2 text-[11px] text-zinc-600">
          <Clock3 className="size-3" />
          <span>{movie.releaseDate ?? "未知"}</span>
          <span
            className={cn(
              "size-2 rounded-full",
              movie.watchStatus === "watched"
                ? "bg-emerald-400"
                : movie.watchStatus === "watching"
                  ? "bg-amber-400"
                  : "bg-zinc-700",
            )}
          />
        </div>
      </div>
    </div>
  );
}

function MovieDetailPage({
  movie,
  onBack,
  backLabel = "返回媒体库",
  onActorSelect,
  onTagSelect,
  onChanged,
  notify,
  ffmpegAvailable,
  previewAvailable,
}: {
  movie: MovieRecord | null;
  onBack: () => void;
  backLabel?: string;
  onActorSelect: (actor: string) => void;
  onTagSelect: (tag: string) => void;
  onChanged: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  ffmpegAvailable: boolean;
  previewAvailable: boolean;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  // The former inline editor remains disabled while the dialog owns the draft.
  const editing = false;
  const [form, setForm] = useState<MoviePatch>({});
  const [loading, setLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState<
    "lookup" | string | null
  >(null);
  const [candidates, setCandidates] = useState<MetadataCandidate[] | null>(
    null,
  );
  const [fileChoices, setFileChoices] = useState(movie?.files ?? []);
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false);
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const [coverDraft, setCoverDraft] = useState<string | null>(null);
  const [javDbImportOpen, setJavDbImportOpen] = useState(false);
  const [javDbHtml, setJavDbHtml] = useState("");
  const [javDbDetails, setJavDbDetails] = useState<MetadataDetails | null>(null);
  const [javDbParsing, setJavDbParsing] = useState(false);
  const [transcode, setTranscode] = useState<TranscodeProgress | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const [previewDeleting, setPreviewDeleting] = useState(false);
  const [previewViewerOpen, setPreviewViewerOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const javDbFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!movie) return;
    setForm({
      code: movie.code,
      title: movie.title,
      description: movie.description,
      releaseDate: movie.releaseDate,
      durationMinutes: movie.durationMinutes,
      director: movie.director,
      studio: movie.studio,
      label: movie.label,
      series: movie.series,
      actors: movie.actors,
      tags: movie.tags,
      watchStatus: movie.watchStatus,
    });
    setEditorOpen(false);
    setCandidates(null);
    setFileChoices([]);
    setCoverEditorOpen(false);
    setCoverDraft(null);
    setJavDbImportOpen(false);
    setJavDbHtml("");
    setJavDbDetails(null);
    setPreviewViewerOpen(false);
    setPreviewZoom(1);
  }, [movie?.id]);

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    if (!movie) return;
    void window.avault.getMoviePreview(movie.id)
      .then((url) => { if (active) setPreviewUrl(url); })
      .catch(() => { if (active) setPreviewUrl(null); });
    return () => { active = false; };
  }, [movie?.id]);

  useEffect(() => {
    if (!coverPreviewOpen && !previewViewerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCoverPreviewOpen(false);
        setPreviewViewerOpen(false);
        setPreviewZoom(1);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [coverPreviewOpen, previewViewerOpen]);

  useEffect(
    () =>
      window.avault.onTranscodeProgress((progress) => {
        if (!movie?.files.some((file) => file.id === progress.fileId)) return;
        setTranscode(progress);
        if (progress.state === "completed") {
          void onChanged();
          notify("转码完成，已添加为新的影片版本");
        }
        if (progress.state === "failed")
          notify(progress.message ?? "转码失败", true);
        if (progress.state === "cancelled") notify("转码已取消");
      }),
    [movie?.id, movie?.files, notify, onChanged],
  );

  useEffect(() => {
    const pasteFromClipboard = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        editorOpen ||
        target?.matches('input, textarea, [contenteditable="true"]')
      )
        return;
      const image = [...(event.clipboardData?.files ?? [])].find((file) =>
        file.type.startsWith("image/"),
      );
      if (!image) return;
      event.preventDefault();
      void loadCoverFile(image);
    };
    window.addEventListener("paste", pasteFromClipboard);
    return () => window.removeEventListener("paste", pasteFromClipboard);
  }, [editorOpen, movie?.id]);

  if (!movie) return null;

  async function save() {
    setLoading(true);
    try {
      if (javDbDetails) await window.avault.saveJavDbHtmlImport(movie!.id, form);
      else await window.avault.updateMovie(movie!.id, form);
      await onChanged();
      closeEditor();
      notify("影片资料已保存");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setLoading(false);
    }
  }

  function resetEditorDraft() {
    setForm({
      code: movie!.code, title: movie!.title, description: movie!.description,
      releaseDate: movie!.releaseDate, durationMinutes: movie!.durationMinutes,
      director: movie!.director, studio: movie!.studio, label: movie!.label,
      series: movie!.series, actors: movie!.actors, tags: movie!.tags, watchStatus: movie!.watchStatus,
    });
    setJavDbImportOpen(false);
    setJavDbHtml("");
    setJavDbDetails(null);
  }

  function openEditor() { resetEditorDraft(); setEditorOpen(true); }
  function closeEditor() { setEditorOpen(false); resetEditorDraft(); }

  function applyJavDbDetails(details: MetadataDetails) {
    setForm((draft) => ({
      ...draft,
      ...(details.code ? { code: details.code } : {}),
      ...(details.title ? { title: details.title } : {}),
      ...(details.description ? { description: details.description } : {}),
      ...(details.releaseDate ? { releaseDate: details.releaseDate } : {}),
      ...(details.durationMinutes != null ? { durationMinutes: details.durationMinutes } : {}),
      ...(details.director ? { director: details.director } : {}),
      ...(details.studio ? { studio: details.studio } : {}),
      ...(details.label ? { label: details.label } : {}),
      ...(details.series ? { series: details.series } : {}),
      ...(details.actors.length ? { actors: details.actors } : {}),
      ...(details.tags.length ? { tags: details.tags } : {}),
    }));
    setJavDbDetails(details);
  }

  async function parseJavDbImport(html = javDbHtml) {
    setJavDbParsing(true);
    try {
      const details = await window.avault.parseJavDbHtml(html);
      applyJavDbDetails(details);
      notify(`已导入 JavDB HTML：${details.code}`);
    } catch (error) { notify(errorMessage(error), true); }
    finally { setJavDbParsing(false); }
  }

  async function readClipboardAndParseJavDbHtml() {
    try {
      const html = await navigator.clipboard.readText();
      if (!html.trim()) throw new Error("剪贴板中没有 HTML 文本");
      setJavDbHtml(html);
      setJavDbImportOpen(true);
      await parseJavDbImport(html);
    } catch (error) { notify(errorMessage(error), true); }
  }

  async function readJavDbHtmlFile(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify("HTML 文件不能超过 5 MB", true); return; }
    try { setJavDbHtml(await file.text()); setJavDbDetails(null); }
    catch { notify("读取 HTML 文件失败", true); }
  }

  async function loadCoverFile(file: File) {
    if (!file.type.startsWith("image/")) {
      notify("请选择图片文件", true);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notify("图片大小需要在 20 MB 以内", true);
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
    setCoverDraft(dataUrl);
    setCoverEditorOpen(true);
  }

  async function saveCoverDraft() {
    if (!coverDraft) return;
    setLoading(true);
    try {
      await window.avault.setCoverData(movie!.id, coverDraft);
      await onChanged();
      setCoverEditorOpen(false);
      setCoverDraft(null);
      notify("封面已更换");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setLoading(false);
    }
  }

  async function deleteCover() {
    setLoading(true);
    try {
      await window.avault.removeCover(movie!.id);
      await onChanged();
      notify("封面已删除");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setLoading(false);
    }
  }

  async function lookup() {
    setMetadataLoading("lookup");
    setCandidates(null);
    try {
      const results = await window.avault.lookupMetadata(movie!.id);
      setCandidates(results);
      if (results.length === 0) notify("没有找到匹配结果", true);
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setMetadataLoading(null);
    }
  }

  async function apply(candidate: MetadataCandidate) {
    setMetadataLoading(candidate.providerId);
    try {
      await window.avault.applyMetadata(
        movie!.id,
        candidate.providerId,
        "preserve",
      );
      await onChanged();
      setCandidates(null);
      notify(
        `${candidate.providerId.startsWith("fc2:") ? "FC2" : "JavBus"} 资料已保存`,
      );
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setMetadataLoading(null);
    }
  }

  async function play(fileId?: string) {
    try {
      const result = await window.avault.playMovie(movie!.id, fileId);
      if (result.needsFileChoice) setFileChoices(result.needsFileChoice);
      else setFileChoices([]);
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  async function startTranscode(fileId: string, kind: "hevc" | "hevc-720p") {
    try {
      await window.avault.startTranscode(fileId, kind);
      notify(
        kind === "hevc"
          ? "已开始转码高清 HEVC 版本"
          : "已开始转码 720p HEVC 版本",
      );
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  async function generatePreview() {
    setPreviewGenerating(true);
    try {
      const url = await window.avault.generateMoviePreview(movie!.id);
      setPreviewUrl(url);
      notify("影片预览图已生成");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setPreviewGenerating(false);
    }
  }

  async function deletePreview() {
    setPreviewDeleting(true);
    try {
      await window.avault.deleteMoviePreview(movie!.id);
      setPreviewViewerOpen(false);
      setPreviewZoom(1);
      setPreviewUrl(null);
      notify("影片预览图已删除");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setPreviewDeleting(false);
    }
  }

  async function replaceOriginal(originalFileId: string, hevcFileId: string) {
    if (
      !window.confirm(
        "确认用高清 HEVC 版替换原片？原片将被永久删除，无法恢复。",
      )
    )
      return;
    try {
      await window.avault.replaceOriginalWithHevc(originalFileId, hevcFileId);
      await onChanged();
      notify("原片已永久删除，HEVC 版已成为主文件");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  async function removeMissingFile(fileId: string) {
    try {
      await window.avault.removeMissingFile(fileId);
      await onChanged();
      notify("已清理失效文件记录");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  const localFilesPanel = (
    <section className="rounded-2xl border border-white/[0.065] bg-black/20 p-4 shadow-xl shadow-black/10">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-zinc-200">
          本地文件与转码版本
        </div>
        {transcode?.state === "running" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.avault.cancelTranscode()}
          >
            取消转码
          </Button>
        )}
      </div>
      {transcode && (
        <div className="mb-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-xs text-violet-200">
          {transcode.state === "queued"
            ? "转码任务已排队…"
            : transcode.state === "running"
              ? `正在转码 ${transcode.percent?.toFixed(1) ?? 0}%${transcode.speed ? ` · ${transcode.speed}` : ""}${transcode.etaSeconds ? ` · 预计剩余 ${Math.ceil(transcode.etaSeconds)} 秒` : ""}`
              : (transcode.message ?? "转码完成")}
        </div>
      )}
      <div className="space-y-2">
        {movie.files.map((file) => {
          const isHevc = /HEVC 原分辨率/.test(file.versionLabel ?? "");
          const isDerived = /HEVC/.test(file.versionLabel ?? "");
          const is720p = /720p HEVC/.test(file.versionLabel ?? "");
          const original = movie.files.find(
            (candidate) => !/HEVC/.test(candidate.versionLabel ?? ""),
          );
          return (
            <div
              key={file.id}
              className="rounded-lg bg-white/[0.035] px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <Video
                  className={cn(
                    "size-4 shrink-0",
                    file.available ? "text-violet-400" : "text-red-400",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-zinc-300">
                    {file.name}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-600">
                    {[
                      file.partLabel,
                      file.versionLabel,
                      formatBytes(file.size),
                      file.available ? "可用" : "文件已失效",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-zinc-500">
                    {mediaSummary(file)}
                  </div>
                </div>
                {file.available ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.avault.revealFile(file.id)}
                    >
                      定位
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => play(file.id)}
                    >
                      播放
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeMissingFile(file.id)}
                  >
                    移除记录
                  </Button>
                )}
              </div>
              {file.available && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-2">
                  {!isDerived && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !ffmpegAvailable || transcode?.state === "running"
                      }
                      onClick={() => startTranscode(file.id, "hevc")}
                    >
                      转码高清 HEVC
                    </Button>
                  )}
                  {!is720p && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !ffmpegAvailable || transcode?.state === "running"
                      }
                      onClick={() => startTranscode(file.id, "hevc-720p")}
                    >
                      转码 720p HEVC
                    </Button>
                  )}
                </div>
              )}
              {isHevc && original && (
                <div className="mt-3 border-t border-white/5 pt-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => replaceOriginal(original.id, file.id)}
                  >
                    用此 HEVC 版替换原片
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="relative isolate min-h-full w-full overflow-hidden">
      {movie.coverUrl && (
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
        >
          <img
            src={movie.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-[1.02] object-cover opacity-38 blur-sm saturate-125"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(14,15,18,.42),rgba(14,15,18,.74)_55%,#0e0f12_100%)]" />
          <div className="absolute inset-0 bg-black/10" />
        </div>
      )}
      <div className="sticky top-0 z-30 flex w-full items-center gap-4 border-b border-white/[0.07] bg-[#0e0f12]/75 px-8 py-4 backdrop-blur-2xl">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {backLabel}
        </Button>
        <div className="h-5 w-px bg-white/10" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-200">
            {movie.code ?? "未识别番号"}
          </div>
          <div className="truncate text-xs text-zinc-600">影片详情</div>
        </div>
      </div>
      <div className="relative z-10 mx-auto grid w-full max-w-[1500px] grid-cols-[540px_minmax(0,1fr)] items-start gap-8 p-8 pt-7">
        <aside className="sticky top-24 w-[540px] space-y-4">
          <div className="group relative overflow-hidden rounded-2xl border border-white/8 bg-zinc-950 shadow-2xl shadow-black/20">
            <button
              type="button"
              onClick={() => movie.coverUrl && setCoverPreviewOpen(true)}
              disabled={!movie.coverUrl}
              className={cn(
                "block w-full text-left",
                movie.coverUrl && "cursor-zoom-in",
              )}
            >
              {movie.coverUrl ? (
                <img
                  src={movie.coverUrl}
                  alt={movie.title}
                  className="block h-auto w-full"
                />
              ) : (
                <div className="aspect-[840/568]">
                  <Cover movie={movie} />
                </div>
              )}
            </button>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 bg-black/55 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label="查看封面"
                onClick={() => setCoverPreviewOpen(true)}
                disabled={!movie.coverUrl}
                className="pointer-events-auto rounded-full border border-white/15 bg-black/45 p-3 text-white shadow-lg transition hover:bg-white/15 disabled:opacity-40"
              >
                <Eye className="size-5" />
              </button>
              <button
                type="button"
                aria-label="编辑封面"
                onClick={() => {
                  setCoverDraft(null);
                  setCoverEditorOpen(true);
                }}
                className="pointer-events-auto rounded-full border border-white/15 bg-black/45 p-3 text-white shadow-lg transition hover:bg-white/15"
              >
                <Pencil className="size-5" />
              </button>
              <button
                type="button"
                aria-label="删除封面"
                onClick={() => void deleteCover()}
                disabled={!movie.coverUrl || loading}
                className="pointer-events-auto rounded-full border border-red-400/30 bg-red-500/25 p-3 text-red-100 shadow-lg transition hover:bg-red-500/40 disabled:opacity-40"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
          </div>
          <section className="rounded-2xl border border-white/[0.065] bg-black/20 p-4 shadow-xl shadow-black/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-zinc-200">影片预览图</div>
                <p className="mt-1 text-xs text-zinc-600">均匀截取 6 帧，合成为 3 × 2 图片</p>
              </div>
              <div className="flex items-center gap-2">
                {previewUrl && <Button size="sm" variant="ghost" disabled={previewGenerating || previewDeleting} onClick={deletePreview} aria-label="删除影片预览图">
                  {previewDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4 text-red-300" />}
                </Button>}
                <Button size="sm" variant="outline" disabled={!previewAvailable || previewGenerating || previewDeleting} onClick={generatePreview}>
                  {previewGenerating ? <LoaderCircle className="size-4 animate-spin" /> : <Images className="size-4" />}
                  {previewGenerating ? "正在生成" : previewUrl ? "重新生成" : "生成预览图"}
                </Button>
              </div>
            </div>
            {previewUrl ? (
              <button type="button" onClick={() => { setPreviewZoom(1); setPreviewViewerOpen(true); }} className="mt-3 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-950">
                <img src={previewUrl} alt={`${movie.title} 的影片预览`} className="block w-full" />
              </button>
            ) : (
              <div className="mt-3 grid h-24 place-items-center rounded-xl border border-dashed border-white/[0.09] text-xs text-zinc-600">
                {previewAvailable ? "尚未生成预览图" : "FFmpeg 不可用"}
              </div>
            )}
          </section>
          {localFilesPanel}
        </aside>
        <div className="min-w-0 rounded-2xl border border-white/[0.065] bg-white/[0.02] p-7">
          <div>
            <h1 className="text-2xl font-semibold text-white">
              {movie.title}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              {movie.files.length} 个本地文件 ·{" "}
              {movie.releaseDate ?? "发行日期未知"}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => play()}>
              <Play className="size-4 fill-current" />
              使用 PotPlayer 播放
            </Button>
            <Button
              variant="secondary"
              onClick={lookup}
              disabled={metadataLoading != null || !movie.code}
            >
              {metadataLoading === "lookup" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {metadataLoading === "lookup" ? "正在爬取…" : "爬取资料"}
            </Button>
            <Button
              variant="outline"
              onClick={openEditor}
            >
              编辑资料
            </Button>
            <Select
              value={movie.watchStatus}
              onValueChange={(value) =>
                window.avault
                  .updateMovie(movie.id, { watchStatus: value as WatchStatus })
                  .then(onChanged)
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unwatched">未观看</SelectItem>
                <SelectItem value="watching">观看中</SelectItem>
                <SelectItem value="watched">已看完</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {editing ? (
            <div className="mt-6 grid grid-cols-2 gap-4">
              <label className="space-y-1.5 text-xs text-zinc-500">
                番号
                <Input
                  value={form.code ?? ""}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                标题
                <Input
                  value={form.title ?? ""}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                发行日期
                <Input
                  type="date"
                  value={form.releaseDate ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, releaseDate: e.target.value || null })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                时长（分钟）
                <Input
                  type="number"
                  value={form.durationMinutes ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      durationMinutes: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                演员
                <Input
                  value={form.actors?.join("、") ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      actors: e.target.value
                        .split(/[、,，]/)
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                标签
                <Input
                  value={form.tags?.join("、") ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tags: e.target.value
                        .split(/[、,，]/)
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                制作商
                <Input
                  value={form.studio ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, studio: e.target.value || null })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                发行商
                <Input
                  value={form.label ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, label: e.target.value || null })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                系列
                <Input
                  value={form.series ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, series: e.target.value || null })
                  }
                />
              </label>
              <label className="space-y-1.5 text-xs text-zinc-500">
                导演
                <Input
                  value={form.director ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, director: e.target.value || null })
                  }
                />
              </label>
              <label className="col-span-2 space-y-1.5 text-xs text-zinc-500">
                简介
                <Textarea
                  value={form.description ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              <div className="col-span-2 flex justify-end">
                <Button onClick={save} disabled={loading}>
                  {loading && <LoaderCircle className="size-4 animate-spin" />}
                  保存修改
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-7 space-y-6">
              <div>
                <h2 className="mb-4 text-sm font-semibold text-zinc-200">
                  影片资料
                </h2>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-5 text-sm">
                  <div>
                    <dt className="text-xs text-zinc-600">番号</dt>
                    <dd className="mt-1 flex items-center gap-2 text-zinc-300">
                      <span>{movie.code ?? "未知"}</span>
                      {movie.code && <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(movie.code!).then(() => notify("番号已复制")).catch(() => notify("复制失败，请手动复制", true))}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs text-zinc-400 transition hover:border-violet-400/35 hover:text-violet-200"
                      >
                        <Copy className="size-3" />复制
                      </button>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">发行日期</dt>
                    <dd className="mt-1 text-zinc-300">
                      {movie.releaseDate ?? "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">时长</dt>
                    <dd className="mt-1 text-zinc-300">
                      {movie.durationMinutes
                        ? `${movie.durationMinutes} 分钟`
                        : "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">导演</dt>
                    <dd className="mt-1 text-zinc-300">
                      {movie.director ?? "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">制作商</dt>
                    <dd className="mt-1 break-words text-zinc-300">
                      {movie.studio ?? "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">发行商</dt>
                    <dd className="mt-1 break-words text-zinc-300">
                      {movie.label ?? "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">系列</dt>
                    <dd className="mt-1 break-words text-zinc-300">
                      {movie.series ?? "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">资料来源</dt>
                    <dd className="mt-1 text-zinc-300">
                      {movie.metadataSource ?? "本地文件"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-600">片源分区</dt>
                    <dd className="mt-1 text-zinc-300">{{ censored: "有码", fc2: "FC2", uncensored: "无码", leaked: "流出", unknown: "待分类" }[movie.sourcePartition]} <span className="ml-1 text-xs text-zinc-600">· {{ manual: "手动", "local-json": "本地 JSON", folder: "媒体文件夹", filename: "番号判断", legacy: "旧数据迁移" }[movie.sourcePartitionSource]}</span></dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-zinc-600">演员</dt>
                    <dd className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                      {movie.actors.length > 0 ? (
                        movie.actors.map((actor) => (
                          <button
                            key={actor}
                            type="button"
                            onClick={() => onActorSelect(actor)}
                            className="text-sm text-violet-300 underline-offset-4 hover:text-violet-200 hover:underline"
                          >
                            {actor}
                          </button>
                        ))
                      ) : (
                        <span className="text-zinc-300">未知</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <div className="mb-3 text-xs text-zinc-600">标签</div>
                {movie.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {movie.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => onTagSelect(tag)}
                        className="rounded-md transition hover:-translate-y-0.5 hover:brightness-125"
                      >
                        <Badge className="cursor-pointer border-violet-400/15 bg-violet-500/[0.08] text-violet-200 hover:border-violet-400/35">
                          {tag}
                        </Badge>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-500">未知</div>
                )}
              </div>
              <div>
                <div className="mb-2 text-xs text-zinc-600">简介</div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-400">
                  {movie.description || "暂无简介"}
                </p>
              </div>
            </div>
          )}

          {candidates && candidates.length > 0 && (
            <div className="mt-6 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-violet-400" />
                选择{" "}
                {candidates[0].providerId.startsWith("fc2:")
                  ? "FC2"
                  : "JavBus"}{" "}
                匹配结果
              </div>
              <div className="space-y-2">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.providerId}
                    onClick={() => apply(candidate)}
                    disabled={metadataLoading != null}
                    className="flex w-full items-center gap-3 rounded-lg bg-black/20 p-3 text-left hover:bg-black/35 disabled:opacity-60"
                  >
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-800">
                      {candidate.previewDataUrl ? (
                        <img
                          src={candidate.previewDataUrl}
                          alt={candidate.code}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Clapperboard className="size-5 text-zinc-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-zinc-100">
                        {candidate.code}
                      </div>
                      <div className="mt-1 truncate text-xs text-zinc-400">
                        {candidate.title}
                      </div>
                    </div>
                    {metadataLoading === candidate.providerId && (
                      <LoaderCircle className="size-5 shrink-0 animate-spin text-violet-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="flex max-h-[88vh] w-[min(860px,96vw)] flex-col overflow-hidden p-0">
          <div className="border-b border-white/[0.08] px-6 py-5">
            <DialogTitle>编辑影片资料</DialogTitle>
            <DialogDescription className="mt-1">保存前可检查和修改所有字段；取消不会写入任何变更。</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-4 py-3">
              <div><div className="flex items-center gap-2 text-sm text-violet-100"><Sparkles className="size-4 text-violet-300" />从剪贴板导入 JavDB HTML</div><p className="mt-1 text-xs text-zinc-500">复制网页 HTML 后，点击即可本地解析并填入草稿。</p></div>
              <div className="flex items-center gap-2"><Button size="sm" onClick={() => void readClipboardAndParseJavDbHtml()} disabled={javDbParsing}>{javDbParsing && <LoaderCircle className="size-4 animate-spin" />}读取并解析</Button><Button size="sm" variant="ghost" onClick={() => setJavDbImportOpen((value) => !value)}>{javDbImportOpen ? "收起手动导入" : "手动导入"}</Button></div>
            </div>
            {javDbImportOpen && <div className="mt-3 space-y-3 rounded-xl border border-white/[0.08] bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs leading-5 text-zinc-400">可粘贴完整网页或影片详情片段；脚本不会执行，最大 5 MB。解析到的非空字段将覆盖当前草稿。</p><Button variant="outline" size="sm" onClick={() => javDbFileInputRef.current?.click()}>选择 HTML 文件</Button></div>
              <input ref={javDbFileInputRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(event) => { void readJavDbHtmlFile(event.target.files?.[0]); event.target.value = ""; }} />
              <Textarea value={javDbHtml} onChange={(event) => { setJavDbHtml(event.target.value); setJavDbDetails(null); }} placeholder="在此粘贴 JavDB 影片网页 HTML…" className="min-h-36 font-mono text-xs" />
              <div className="flex items-center justify-between gap-3"><span className="text-xs text-zinc-600">{Math.ceil(new Blob([javDbHtml]).size / 1024)} KB / 5 MB</span><Button size="sm" onClick={() => void parseJavDbImport()} disabled={!javDbHtml.trim() || javDbParsing}>{javDbParsing && <LoaderCircle className="size-4 animate-spin" />}{javDbParsing ? "正在解析…" : "解析并填入草稿"}</Button></div>
              {javDbDetails && <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-100">已解析 {javDbDetails.code} · {javDbDetails.actors.length} 位演员 · {javDbDetails.tags.length} 个标签 · 不会下载或修改封面</div>}
              {javDbDetails?.code && javDbDetails.code !== movie.code && <p className="text-xs text-amber-200">番号将改为 {javDbDetails.code}；若媒体库已有相同番号，保存时可能合并影片记录。</p>}
            </div>}
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-zinc-500">番号<Input value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">标题<Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">发行日期<Input type="date" value={form.releaseDate ?? ""} onChange={(e) => setForm({ ...form, releaseDate: e.target.value || null })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">时长（分钟）<Input type="number" value={form.durationMinutes ?? ""} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value ? Number(e.target.value) : null })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">演员<Input value={form.actors?.join("、") ?? ""} onChange={(e) => setForm({ ...form, actors: e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean) })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">标签<Input value={form.tags?.join("、") ?? ""} onChange={(e) => setForm({ ...form, tags: e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean) })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">制作商<Input value={form.studio ?? ""} onChange={(e) => setForm({ ...form, studio: e.target.value || null })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">发行商<Input value={form.label ?? ""} onChange={(e) => setForm({ ...form, label: e.target.value || null })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">系列<Input value={form.series ?? ""} onChange={(e) => setForm({ ...form, series: e.target.value || null })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">导演<Input value={form.director ?? ""} onChange={(e) => setForm({ ...form, director: e.target.value || null })} /></label>
              <label className="space-y-1.5 text-xs text-zinc-500">片源分区<Select value={form.sourcePartition ?? movie.sourcePartition} onValueChange={(value) => setForm({ ...form, sourcePartition: value as SourcePartition })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="censored">有码</SelectItem><SelectItem value="fc2">FC2</SelectItem><SelectItem value="uncensored">无码</SelectItem><SelectItem value="leaked">流出</SelectItem><SelectItem value="unknown">待分类</SelectItem></SelectContent></Select></label>
              <label className="space-y-1.5 text-xs text-zinc-500 sm:col-span-2">简介<Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-28" /></label>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.08] px-6 py-4"><Button variant="ghost" onClick={closeEditor} disabled={loading}>取消</Button><Button onClick={save} disabled={loading}>{loading && <LoaderCircle className="size-4 animate-spin" />}保存资料</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={coverEditorOpen}
        onOpenChange={(open) => {
          setCoverEditorOpen(open);
          if (!open) setCoverDraft(null);
        }}
      >
        <DialogContent className="w-[min(620px,94vw)] p-6">
          <DialogTitle>编辑封面</DialogTitle>
          <DialogDescription className="mt-2">
            选择图片、拖入图片或直接粘贴图片，然后确认替换。
          </DialogDescription>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadCoverFile(file);
              event.target.value = "";
            }}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => coverInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                coverInputRef.current?.click();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = [...event.dataTransfer.files].find((item) =>
                item.type.startsWith("image/"),
              );
              if (file) void loadCoverFile(file);
              else notify("请拖入图片文件", true);
            }}
            className="mt-5 flex min-h-72 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-center transition hover:border-violet-400/50 hover:bg-violet-500/[0.04]"
          >
            {coverDraft ? (
              <img
                src={coverDraft}
                alt="待替换封面预览"
                className="max-h-64 max-w-full rounded-lg object-contain"
              />
            ) : (
              <div>
                <Pencil className="mx-auto size-8 text-violet-300" />
                <div className="mt-3 text-sm text-zinc-300">
                  点击选择图片，或将图片拖到这里
                </div>
                <div className="mt-1 text-xs text-zinc-600">
                  也可以直接按 Ctrl+V 粘贴
                </div>
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCoverEditorOpen(false);
                setCoverDraft(null);
              }}
            >
              取消
            </Button>
            <Button onClick={saveCoverDraft} disabled={!coverDraft || loading}>
              {loading && <LoaderCircle className="size-4 animate-spin" />}
              确认替换
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {coverPreviewOpen && movie.coverUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="查看原始封面"
          onClick={() => setCoverPreviewOpen(false)}
          className="fixed inset-0 z-[200] flex cursor-zoom-out items-center justify-center bg-black/90 p-8 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setCoverPreviewOpen(false)}
            className="absolute right-6 top-6 rounded-full border border-white/10 bg-black/50 p-3 text-zinc-300 hover:bg-white/10 hover:text-white"
            aria-label="关闭封面预览"
          >
            <X className="size-5" />
          </button>
          <img
            src={movie.coverUrl}
            alt={movie.title}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full cursor-default object-contain shadow-2xl"
          />
        </div>
      )}
      {previewViewerOpen && previewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="查看影片预览图"
          onClick={() => { setPreviewViewerOpen(false); setPreviewZoom(1); }}
          className="fixed inset-0 z-[200] flex cursor-zoom-out items-center justify-center overflow-hidden bg-black/90 p-8 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => { setPreviewViewerOpen(false); setPreviewZoom(1); }}
            className="absolute right-6 top-6 rounded-full border border-white/10 bg-black/50 p-3 text-zinc-300 hover:bg-white/10 hover:text-white"
            aria-label="关闭影片预览"
          >
            <X className="size-5" />
          </button>
          <div
            onWheel={(event) => {
              event.preventDefault();
              setPreviewZoom((current) => {
                const next = Number((current + (event.deltaY < 0 ? 0.15 : -0.15)).toFixed(2));
                return Math.min(3, Math.max(0.5, next));
              });
            }}
            className="flex h-full w-full cursor-zoom-in items-center justify-center"
          >
            <img
              src={previewUrl}
              alt={`${movie.title} 的影片预览`}
              onClick={(event) => event.stopPropagation()}
              style={{ transform: `scale(${previewZoom})` }}
              className="max-h-full max-w-full select-none object-contain shadow-2xl transition-transform duration-150"
            />
          </div>
          <div className="pointer-events-none absolute bottom-6 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs text-zinc-300">
            滚动鼠标缩放 · {Math.round(previewZoom * 100)}%
          </div>
        </div>
      )}
    </div>
  );
}

function ActorMoviesPage({
  actor,
  movies,
  coverMode,
  onBack,
  onOpen,
  onPlay,
  notify,
  backLabel = "返回影片详情",
}: {
  actor: string;
  movies: MovieRecord[];
  coverMode: GridCoverMode;
  onBack: () => void;
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
  notify: (message: string, error?: boolean) => void;
  backLabel?: string;
}) {
  const [profile, setProfile] = useState<ActorProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [avatarFetching, setAvatarFetching] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ActorProfilePatch | null>(
    null,
  );
  const [socialLinksText, setSocialLinksText] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [movieSearch, setMovieSearch] = useState("");
  const [movieWatchFilter, setMovieWatchFilter] = useState<
    "all" | WatchStatus
  >("all");
  const [movieSort, setMovieSort] = useState<
    "release-desc" | "release-asc" | "added-desc" | "code-asc"
  >("release-desc");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const filteredMovies = useMemo(() => {
    const needle = movieSearch.trim().toLocaleLowerCase();
    const result = movies.filter((movie) => {
      if (movieWatchFilter !== "all" && movie.watchStatus !== movieWatchFilter)
        return false;
      return (
        !needle ||
        [movie.code, movie.title, ...movie.tags].some((value) =>
          value?.toLocaleLowerCase().includes(needle),
        )
      );
    });
    return result.sort((left, right) => {
      if (movieSort === "code-asc")
        return (left.code ?? "").localeCompare(right.code ?? "");
      if (movieSort === "added-desc")
        return right.createdAt.localeCompare(left.createdAt);
      if (!left.releaseDate && !right.releaseDate)
        return right.createdAt.localeCompare(left.createdAt);
      if (!left.releaseDate) return 1;
      if (!right.releaseDate) return -1;
      return movieSort === "release-asc"
        ? left.releaseDate.localeCompare(right.releaseDate)
        : right.releaseDate.localeCompare(left.releaseDate);
    });
  }, [movieSearch, movieSort, movieWatchFilter, movies]);

  useEffect(() => {
    setProfile(null);
    setAvatarEditorOpen(false);
    setAvatarPreviewOpen(false);
    setAvatarDraft(null);
    window.avault
      .getActorProfile(actor)
      .then(setProfile)
      .catch(() => undefined);
  }, [actor]);

  useEffect(() => {
    if (!avatarEditorOpen) return;
    const pasteFromClipboard = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      const image = [...(event.clipboardData?.files ?? [])].find((file) =>
        file.type.startsWith("image/"),
      );
      if (!image) return;
      event.preventDefault();
      void loadAvatarFile(image);
    };
    window.addEventListener("paste", pasteFromClipboard);
    return () => window.removeEventListener("paste", pasteFromClipboard);
  }, [avatarEditorOpen]);

  async function lookupProfile() {
    setLoading(true);
    try {
      setProfile(await window.avault.lookupActorProfile(actor));
      notify("AI 演员资料已保存");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAvatar() {
    setAvatarFetching(true);
    try {
      setProfile(await window.avault.fetchActorAvatar(actor));
      notify("已从 Gfriends 获取演员头像");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setAvatarFetching(false);
    }
  }

  function openProfileEditor() {
    const draft = {
      category: profile?.category ?? null,
      aliases: profile?.aliases ?? [],
      birthday: profile?.birthday ?? null,
      bust: profile?.bust ?? null,
      waist: profile?.waist ?? null,
      hip: profile?.hip ?? null,
      height: profile?.height ?? null,
      debutYear: profile?.debutYear ?? null,
      socialLinks: profile?.socialLinks ?? [],
    };
    setProfileDraft(draft);
    setSocialLinksText(
      draft.socialLinks.map((link) => `${link.platform} | ${link.url}`).join("\n"),
    );
    setProfileEditorOpen(true);
  }

  async function saveProfileDraft() {
    if (!profileDraft) return;
    setProfileSaving(true);
    try {
      const socialLinks = socialLinksText.split(/\r?\n/).flatMap((line) => {
        const [platform, ...url] = line.split("|");
        return platform?.trim() && url.join("|").trim()
          ? [{ platform: platform.trim(), url: url.join("|").trim() }]
          : [];
      });
      setProfile(await window.avault.updateActorProfile(actor, { ...profileDraft, socialLinks }));
      setProfileEditorOpen(false);
      notify("演员资料已保存");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setProfileSaving(false);
    }
  }

  async function loadAvatarFile(file: File) {
    if (!file.type.startsWith("image/")) {
      notify("请选择图片文件", true);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notify("图片大小需要在 20 MB 以内", true);
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
    setAvatarDraft(dataUrl);
    setAvatarEditorOpen(true);
  }

  async function saveAvatarDraft() {
    if (!avatarDraft) return;
    setAvatarSaving(true);
    try {
      setProfile(await window.avault.setActorAvatarData(actor, avatarDraft));
      setAvatarEditorOpen(false);
      setAvatarDraft(null);
      notify("演员头像已更换");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setAvatarSaving(false);
    }
  }

  async function deleteAvatar() {
    setAvatarSaving(true);
    try {
      setProfile(await window.avault.removeActorAvatar(actor));
      notify("演员头像已删除");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setAvatarSaving(false);
    }
  }

  return (
    <div className="min-h-full w-full">
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-white/[0.055] bg-[#0e0f12]/85 px-8 py-4 backdrop-blur-xl">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {backLabel}
        </Button>
        <div className="h-5 w-px bg-white/10" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-zinc-200">
            {actor}
          </h1>
          <p className="text-xs text-zinc-600">演员影片</p>
        </div>
      </header>
      <div className="p-8">
        <section className="flex items-center gap-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 shadow-xl shadow-black/10">
          <div className="group relative flex h-44 w-[10.1rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-lg">
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={actor}
                className="h-full w-full object-cover"
              />
            ) : (
              <Users className="size-10 text-zinc-700" />
            )}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/55 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label="查看演员头像"
                onClick={() => setAvatarPreviewOpen(true)}
                disabled={!profile?.avatarUrl}
                className="pointer-events-auto rounded-full border border-white/15 bg-black/45 p-2.5 text-white transition hover:bg-white/15 disabled:opacity-40"
              >
                <Eye className="size-4" />
              </button>
              <button
                type="button"
                aria-label="编辑演员头像"
                onClick={() => {
                  setAvatarDraft(null);
                  setAvatarEditorOpen(true);
                }}
                className="pointer-events-auto rounded-full border border-white/15 bg-black/45 p-2.5 text-white transition hover:bg-white/15"
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                aria-label="删除演员头像"
                onClick={() => void deleteAvatar()}
                disabled={!profile?.avatarUrl || avatarSaving}
                className="pointer-events-auto rounded-full border border-red-400/30 bg-red-500/25 p-2.5 text-red-100 transition hover:bg-red-500/40 disabled:opacity-40"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-white">
                {actor}
              </h1>
              {profile?.category && (
                <Badge className="border-0 bg-violet-500/12 text-violet-300">
                  {profile.category}
                </Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={fetchAvatar}
                disabled={avatarFetching}
              >
                {avatarFetching ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Users className="size-4" />
                )}
                {avatarFetching
                  ? "正在获取头像…"
                  : profile?.avatarUrl
                    ? "更新头像"
                    : "获取头像"}
              </Button>
              <Button size="sm" variant="secondary" onClick={openProfileEditor}>
                <Pencil className="size-4" />
                编辑资料
              </Button>
              <Button
                size="sm"
                variant={profile ? "secondary" : "default"}
                onClick={lookupProfile}
                disabled={loading}
              >
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {loading
                  ? "AI 正在整理…"
                  : profile
                    ? "AI 更新资料"
                    : "AI 获取资料"}
              </Button>
            </div>
            {profile && profile.aliases.length > 0 && (
              <p className="mt-1 truncate text-xs text-zinc-500">
                别名：{profile.aliases.join("、")}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-6 gap-x-7 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-600">本地影片</dt>
                <dd className="mt-1 text-zinc-200">{movies.length} 部</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600">生日</dt>
                <dd className="mt-1 text-zinc-200">
                  {profile?.birthday ?? "未知"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600">年龄</dt>
                <dd className="mt-1 text-zinc-200">
                  {ageFromBirthday(profile?.birthday)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600">身高</dt>
                <dd className="mt-1 text-zinc-200">
                  {profile?.height ? `${profile.height} cm` : "未知"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600">三围</dt>
                <dd className="mt-1 text-zinc-200">
                  {profile?.bust || profile?.waist || profile?.hip
                    ? `B${profile.bust ?? "?"} / W${profile.waist ?? "?"} / H${profile.hip ?? "?"}`
                    : "未知"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-600">出道年份</dt>
                <dd className="mt-1 text-zinc-200">
                  {profile?.debutYear ?? "未知"}
                </dd>
              </div>
            </dl>
            {profile?.socialLinks && profile.socialLinks.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-zinc-600">社交媒体</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.socialLinks.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      onClick={(event) => {
                        event.preventDefault();
                        void window.avault
                          .openExternal(link.url)
                          .catch((error) => notify(errorMessage(error), true));
                      }}
                      className="rounded-md border border-violet-400/20 bg-violet-500/[0.08] px-2.5 py-1 text-xs text-violet-200 transition hover:bg-violet-500/[0.16]"
                    >
                      {link.platform}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-3 text-[11px] text-zinc-700">
              资料来源：{profile?.metadataSource ?? "尚未获取"}
              {profile
                ? ` · 更新于 ${formatDate(profile.metadataUpdatedAt)}`
                : ""}
            </p>
          </div>
        </section>
        <section className="mb-8 mt-10 border-b border-white/[0.055] pb-5">
          <div className="flex items-center gap-5">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-bold tracking-tight text-zinc-100">
                参演影片
              </h2>
              <p className="mt-1 text-xs text-zinc-600">
                共 {movies.length} 部影片 · 显示 {filteredMovies.length} 部
              </p>
            </div>
            <div className="relative w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" />
              <Input
                value={movieSearch}
                onChange={(event) => setMovieSearch(event.target.value)}
                placeholder="搜索番号、标题或标签"
                className="pl-9"
              />
            </div>
          </div>
          {movies.length > 0 && (
            <div className="mt-5 flex items-center gap-2">
              <Select value={movieWatchFilter} onValueChange={(value) => setMovieWatchFilter(value as "all" | WatchStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="unwatched">未观看</SelectItem>
                  <SelectItem value="watching">观看中</SelectItem>
                  <SelectItem value="watched">已看完</SelectItem>
                </SelectContent>
              </Select>
              <Select value={movieSort} onValueChange={(value) => setMovieSort(value as "release-desc" | "release-asc" | "added-desc" | "code-asc")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="release-desc">发行日期（最新）</SelectItem>
                  <SelectItem value="release-asc">发行日期（最早）</SelectItem>
                  <SelectItem value="added-desc">最近添加</SelectItem>
                  <SelectItem value="code-asc">番号排序</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </section>
        {filteredMovies.length > 0 ? (
          <div
            className={cn(
              "grid gap-x-6 gap-y-9",
              coverMode === "portrait"
                ? "grid-cols-[repeat(auto-fill,minmax(205px,1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]",
            )}
          >
            {filteredMovies.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                mode="grid"
                coverMode={coverMode}
                onOpen={() => onOpen(movie.id)}
                onPlay={() => onPlay(movie.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[420px] items-center justify-center text-sm text-zinc-500">
            {movies.length === 0
              ? "本地媒体库中没有找到该演员的影片"
              : "没有符合当前筛选条件的影片"}
          </div>
        )}
      </div>
      <Dialog open={profileEditorOpen} onOpenChange={setProfileEditorOpen}>
        <DialogContent className="w-[min(760px,94vw)] p-6">
          <DialogTitle>编辑演员资料</DialogTitle>
          <DialogDescription className="mt-2">
            留空表示未知。社交链接每行一条，格式为“平台名称 | https://链接”。
          </DialogDescription>
          {profileDraft && (
            <div className="mt-5 grid grid-cols-2 gap-4">
              <label className="text-sm text-zinc-400">
                分类
                <Input
                  className="mt-2"
                  value={profileDraft.category ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      category: event.target.value || null,
                    })
                  }
                />
              </label>
              <label className="text-sm text-zinc-400">
                别名（用顿号或逗号分隔）
                <Input
                  className="mt-2"
                  value={profileDraft.aliases.join("、")}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      aliases: event.target.value
                        .split(/[、,，]/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="text-sm text-zinc-400">
                生日
                <Input
                  type="date"
                  className="mt-2"
                  value={profileDraft.birthday ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      birthday: event.target.value || null,
                    })
                  }
                />
              </label>
              <label className="text-sm text-zinc-400">
                出道年份
                <Select
                  value={profileDraft.debutYear?.toString() ?? "unknown"}
                  onValueChange={(value) =>
                    setProfileDraft({
                      ...profileDraft,
                      debutYear: value === "unknown" ? null : Number(value),
                    })
                  }
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">未知</SelectItem>
                    {Array.from(
                      { length: new Date().getFullYear() - 1940 + 1 },
                      (_, index) => new Date().getFullYear() - index,
                    ).map((year) => (
                      <SelectItem key={year} value={year.toString()}>
                        {year} 年
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-sm text-zinc-400">
                身高（cm）
                <Input
                  type="number"
                  className="mt-2"
                  value={profileDraft.height ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      height: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label className="text-sm text-zinc-400">
                胸围 B（cm）
                <Input
                  type="number"
                  className="mt-2"
                  value={profileDraft.bust ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      bust: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label className="text-sm text-zinc-400">
                腰围 W（cm）
                <Input
                  type="number"
                  className="mt-2"
                  value={profileDraft.waist ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      waist: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label className="text-sm text-zinc-400">
                臀围 H（cm）
                <Input
                  type="number"
                  className="mt-2"
                  value={profileDraft.hip ?? ""}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      hip: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label className="col-span-2 text-sm text-zinc-400">
                社交媒体链接
                <Textarea
                  className="mt-2 min-h-28 font-mono text-xs"
                  value={socialLinksText}
                  onChange={(event) => setSocialLinksText(event.target.value)}
                />
              </label>
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setProfileEditorOpen(false)}>
              取消
            </Button>
            <Button
              onClick={saveProfileDraft}
              disabled={!profileDraft || profileSaving}
            >
              {profileSaving && (
                <LoaderCircle className="size-4 animate-spin" />
              )}
              保存资料
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={avatarEditorOpen}
        onOpenChange={(open) => {
          setAvatarEditorOpen(open);
          if (!open) setAvatarDraft(null);
        }}
      >
        <DialogContent className="w-[min(620px,94vw)] p-6">
          <DialogTitle>编辑演员头像</DialogTitle>
          <DialogDescription className="mt-2">
            选择图片、拖入图片或直接粘贴图片，然后确认替换。
          </DialogDescription>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadAvatarFile(file);
              event.target.value = "";
            }}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => avatarInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                avatarInputRef.current?.click();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = [...event.dataTransfer.files].find((item) =>
                item.type.startsWith("image/"),
              );
              if (file) void loadAvatarFile(file);
              else notify("请拖入图片文件", true);
            }}
            className="mt-5 flex min-h-72 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-center transition hover:border-violet-400/50 hover:bg-violet-500/[0.04]"
          >
            {avatarDraft ? (
              <img
                src={avatarDraft}
                alt="待替换演员头像预览"
                className="max-h-64 max-w-full rounded-lg object-contain"
              />
            ) : (
              <div>
                <Pencil className="mx-auto size-8 text-violet-300" />
                <div className="mt-3 text-sm text-zinc-300">
                  点击选择图片，或将图片拖到这里
                </div>
                <div className="mt-1 text-xs text-zinc-600">
                  也可以直接按 Ctrl+V 粘贴
                </div>
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAvatarEditorOpen(false);
                setAvatarDraft(null);
              }}
            >
              取消
            </Button>
            <Button
              onClick={saveAvatarDraft}
              disabled={!avatarDraft || avatarSaving}
            >
              {avatarSaving && <LoaderCircle className="size-4 animate-spin" />}
              确认替换
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {avatarPreviewOpen && profile?.avatarUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="查看演员头像"
          onClick={() => setAvatarPreviewOpen(false)}
          className="fixed inset-0 z-[200] flex cursor-zoom-out items-center justify-center bg-black/90 p-8 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setAvatarPreviewOpen(false)}
            className="absolute right-6 top-6 rounded-full border border-white/10 bg-black/50 p-3 text-zinc-300 hover:bg-white/10 hover:text-white"
            aria-label="关闭演员头像"
          >
            <X className="size-5" />
          </button>
          <img
            src={profile.avatarUrl}
            alt={actor}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full cursor-default object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}

function TagMoviesPage({
  tag,
  movies,
  coverMode,
  onBack,
  onOpen,
  onPlay,
}: {
  tag: string;
  movies: MovieRecord[];
  coverMode: GridCoverMode;
  onBack: () => void;
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
}) {
  return (
    <div className="min-h-full w-full">
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-white/[0.055] bg-[#0e0f12]/85 px-8 py-4 backdrop-blur-xl">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          返回影片详情
        </Button>
        <div className="h-5 w-px bg-white/10" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-zinc-200">
            {tag}
          </h1>
          <p className="text-xs text-zinc-600">标签影片</p>
        </div>
      </header>
      <div className="p-8">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <div className="mb-2 text-xs text-zinc-600">标签</div>
            <Badge className="border-violet-400/15 bg-violet-500/[0.08] text-violet-200">
              {tag}
            </Badge>
            <h2 className="mt-4 text-xl font-semibold text-zinc-100">
              相关影片
            </h2>
          </div>
          <Badge className="border-0 bg-white/5 text-zinc-400">
            {movies.length} 部
          </Badge>
        </div>
        {movies.length > 0 ? (
          <div
            className={cn(
              "grid gap-x-6 gap-y-9",
              coverMode === "portrait"
                ? "grid-cols-[repeat(auto-fill,minmax(205px,1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]",
            )}
          >
            {movies.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                mode="grid"
                coverMode={coverMode}
                onOpen={() => onOpen(movie.id)}
                onPlay={() => onPlay(movie.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[420px] items-center justify-center text-sm text-zinc-500">
            本地媒体库中没有找到该标签的影片
          </div>
        )}
      </div>
    </div>
  );
}

function ActorLibraryPage({
  actors,
  onOpen,
}: {
  actors: Array<{ name: string; movieCount: number }>;
  onOpen: (actor: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<Record<string, ActorProfile | null>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    setProfiles({});
    void Promise.all(
      actors.map(
        async ({ name }) =>
          [
            name,
            await window.avault.getActorProfile(name).catch(() => null),
          ] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setProfiles(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [actors]);

  const filteredActors = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? actors.filter(({ name }) => name.toLocaleLowerCase().includes(needle))
      : actors;
  }, [actors, search]);

  return (
    <div className="min-h-full w-full">
      <header className="sticky top-0 z-30 border-b border-white/[0.055] bg-[#0e0f12]/85 px-8 py-5 backdrop-blur-xl">
        <div className="flex items-center gap-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">演员库</h1>
            <p className="mt-1 text-xs text-zinc-600">
              本地媒体库共收录 {actors.length} 位演员
            </p>
          </div>
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索演员名称"
              className="pl-9"
            />
          </div>
        </div>
      </header>
      <div className="p-8">
        {filteredActors.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredActors.map(({ name, movieCount }) => {
              const profile = profiles[name];
              return (
                <button
                  key={name}
                  onClick={() => onOpen(name)}
                  className="group flex min-w-0 items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-400/30 hover:bg-violet-500/[0.05]"
                >
                  <div className="flex h-28 w-[5.35rem] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
                    {profile?.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Users className="size-6 text-zinc-700" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-semibold text-zinc-100 group-hover:text-violet-200">
                        {name}
                      </h2>
                      {profile?.category && (
                        <Badge className="border-0 bg-violet-500/10 text-[10px] text-violet-300">
                          {profile.category}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {movieCount} 部本地影片
                    </p>
                    <p className="mt-2 truncate text-[11px] text-zinc-700">
                      {profile
                        ? [
                            profile.birthday,
                            profile.height ? `${profile.height} cm` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "资料已保存"
                        : "尚未获取资料"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-zinc-500">
            <Users className="mb-4 size-10 text-zinc-700" />
            <p className="text-sm">没有找到匹配的演员</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DevicesPage({
  snapshot,
  refresh,
  notify,
}: {
  snapshot: AppSnapshot;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [pairing, setPairing] = useState<PairingDisplay | null>(null);
  const [loading, setLoading] = useState(false);
  async function createPairing() {
    setLoading(true);
    try {
      setPairing(await window.avault.createPairing());
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setLoading(false);
    }
  }
  async function revoke(id: string) {
    await window.avault.revokeDevice(id);
    await refresh();
    notify("设备授权已撤销");
  }
  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">连接手机</h1>
          <p className="mt-2 text-sm text-zinc-500">
            手机与电脑需处于同一局域网，首次连接请扫描二维码。
          </p>
        </div>
        <Button
          onClick={createPairing}
          disabled={loading || !snapshot.server.running}
        >
          <MonitorSmartphone className="size-4" />
          生成配对二维码
        </Button>
      </div>
      <div className="mt-8 grid grid-cols-[1fr_360px] gap-6">
        <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">已配对设备</h2>
            <Badge className="border-0 bg-violet-500/10 text-violet-300">
              {snapshot.devices.filter((d) => !d.revoked).length} 台
            </Badge>
          </div>
          {snapshot.devices.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-zinc-600">
              <Users className="mb-3 size-8" />
              <p className="text-sm">还没有配对设备</p>
            </div>
          ) : (
            <div className="space-y-2">
              {snapshot.devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center gap-3 rounded-xl border border-white/6 bg-black/15 p-4"
                >
                  <div className="rounded-lg bg-violet-500/10 p-2">
                    <MonitorSmartphone className="size-5 text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-200">
                      {device.name}
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      最后连接：{formatDate(device.lastSeenAt)}
                    </div>
                  </div>
                  {device.revoked ? (
                    <Badge className="border-0 bg-red-500/10 text-red-300">
                      已撤销
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => revoke(device.id)}
                    >
                      撤销
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-5">
          <h2 className="font-semibold">局域网服务</h2>
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-black/20 p-3">
            {snapshot.server.running ? (
              <Wifi className="size-5 text-emerald-400" />
            ) : (
              <WifiOff className="size-5 text-red-400" />
            )}
            <div>
              <div className="text-sm text-zinc-200">
                {snapshot.server.running ? "服务正在运行" : "服务不可用"}
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                {snapshot.server.host && snapshot.server.port
                  ? `${snapshot.server.host}:${snapshot.server.port}`
                  : (snapshot.server.error ?? "等待网络连接")}
              </div>
            </div>
          </div>
          {pairing ? (
            <div className="mt-5 text-center">
              <img
                src={pairing.qrDataUrl}
                className="mx-auto w-64 rounded-xl bg-white p-3"
              />
              <p className="mt-3 text-xs text-zinc-500">
                二维码 5 分钟内有效，成功配对后立即失效。
              </p>
              <p className="mt-1 font-mono text-[11px] text-zinc-700">
                {pairing.payload.host}:{pairing.payload.port}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() =>
                  navigator.clipboard
                    .writeText(JSON.stringify(pairing.payload))
                    .then(() => notify("配对文本已复制"))
                    .catch(() => notify("复制失败，请使用二维码", true))
                }
              >
                复制配对文本
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-zinc-600">
              <MonitorSmartphone className="mb-3 size-9" />
              <p className="text-sm">点击生成二维码</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TasksPage({
  snapshot,
  tasks,
  onChanged,
  notify,
}: {
  snapshot: AppSnapshot;
  tasks: TranscodeProgress[];
  onChanged: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  async function remove(task: TranscodeProgress) {
    try {
      await window.avault.removeTranscodeTask(task.fileId, task.kind);
      await onChanged();
      notify("任务已移除");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  const sorted = [...tasks].sort((a, b) =>
    a.state === "running"
      ? -1
      : b.state === "running"
        ? 1
        : a.state === "queued"
          ? -1
          : b.state === "queued"
            ? 1
            : 0,
  );
  return (
    <div className="mx-auto max-w-5xl p-8">
      <div>
        <h1 className="text-2xl font-bold">转码任务</h1>
        <p className="mt-2 text-sm text-zinc-500">
          任务按顺序执行，同一时间只会使用一个 NVIDIA 编码任务。
        </p>
      </div>
      <div className="mt-8 space-y-3">
        {sorted.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 text-zinc-600">
            <Archive className="mb-3 size-9" />
            <p className="text-sm">暂无转码任务</p>
          </div>
        ) : (
          sorted.map((task) => {
            const file = snapshot.movies
              .flatMap((movie) => movie.files)
              .find((candidate) => candidate.id === task.fileId);
            const label =
              task.kind === "hevc"
                ? "高清 HEVC · 2.5 Mbps"
                : "720p HEVC · 1.5 Mbps";
            const running = task.state === "running";
            const queued = task.state === "queued";
            return (
              <div
                key={`${task.fileId}:${task.kind}`}
                className="rounded-xl border border-white/8 bg-white/[0.025] p-4"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "rounded-lg p-2",
                      running
                        ? "bg-violet-500/15 text-violet-300"
                        : queued
                          ? "bg-amber-500/10 text-amber-300"
                          : task.state === "completed"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-red-500/10 text-red-300",
                    )}
                  >
                    <Video className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-zinc-200">
                      {file?.name ?? "源文件已移除"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">{label}</div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          task.state === "failed"
                            ? "bg-red-400"
                            : task.state === "cancelled"
                              ? "bg-zinc-500"
                              : task.state === "completed"
                                ? "bg-emerald-400"
                                : "bg-violet-400",
                        )}
                        style={{ width: `${task.percent ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">
                      {running
                        ? `正在转码 ${task.percent?.toFixed(1) ?? 0}%${task.speed ? ` · ${task.speed}` : ""}${task.etaSeconds ? ` · 预计剩余 ${Math.ceil(task.etaSeconds)} 秒` : ""}`
                        : queued
                          ? "等待前方任务完成"
                          : (task.message ??
                            (task.state === "completed"
                              ? "转码完成"
                              : "任务已取消"))}
                    </div>
                  </div>
                  {running ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.avault.cancelTranscode()}
                    >
                      取消
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(task)}
                    >
                      {queued ? "移出队列" : "移除"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function LogsPage({
  notify,
}: {
  notify: (message: string, error?: boolean) => void;
}) {
  const [scope, setScope] = useState<"all" | AppLogEntry["scope"]>("all");
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [selected, setSelected] = useState<AppLogEntry | null>(null);
  const load = useCallback(
    () =>
      window.avault
        .getLogs(scope === "all" ? undefined : scope)
        .then(setLogs)
        .catch((error) => notify(errorMessage(error), true)),
    [scope, notify],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function clear() {
    try {
      await window.avault.clearLogs(scope === "all" ? undefined : scope);
      setSelected(null);
      await load();
      notify("日志已清理");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="text-2xl font-bold">运行日志</h1>
          <p className="mt-2 text-sm text-zinc-500">
            保留最近 500 条记录。AI 日志包含原始返回；FFmpeg 日志包含完整命令。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            刷新
          </Button>
          <Button
            variant="ghost"
            onClick={() => void clear()}
            disabled={logs.length === 0}
          >
            清理日志
          </Button>
        </div>
      </div>
      <div className="mt-6 flex gap-2">
        <Button
          size="sm"
          variant={scope === "all" ? "default" : "secondary"}
          onClick={() => setScope("all")}
        >
          全部
        </Button>
        <Button
          size="sm"
          variant={scope === "ai" ? "default" : "secondary"}
          onClick={() => setScope("ai")}
        >
          AI 资料
        </Button>
        <Button
          size="sm"
          variant={scope === "metadata" ? "default" : "secondary"}
          onClick={() => setScope("metadata")}
        >
          影片资料
        </Button>
        <Button
          size="sm"
          variant={scope === "ffmpeg" ? "default" : "secondary"}
          onClick={() => setScope("ffmpeg")}
        >
          FFmpeg
        </Button>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.025]">
        {logs.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-zinc-600">
            暂无日志
          </div>
        ) : (
          logs.map((log) => (
            <button
              key={log.id}
              onClick={() => setSelected(log)}
              className="flex w-full items-center gap-4 border-b border-white/[0.055] px-5 py-3 text-left transition last:border-0 hover:bg-white/[0.035]"
            >
              <Badge
                className={cn("border-0", log.scope === "ai" ? "bg-sky-500/10 text-sky-300" : log.scope === "metadata" ? "bg-amber-500/10 text-amber-300" : "bg-violet-500/10 text-violet-300")}
              >
                {log.scope === "ai" ? "AI" : log.scope === "metadata" ? "影片资料" : "FFmpeg"}
              </Badge>
              <span
                className={cn(
                  "size-2 rounded-full",
                  log.level === "error" ? "bg-red-400" : "bg-emerald-400",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                {log.message}
              </span>
              <span className="shrink-0 text-xs text-zinc-600">
                {formatDate(log.createdAt)}
              </span>
            </button>
          ))
        )}
      </div>
      {selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <DialogContent className="w-[min(900px,94vw)] p-6">
            <DialogTitle>{selected.message}</DialogTitle>
            <DialogDescription className="mt-1">
              {formatDate(selected.createdAt)} ·{" "}
              {selected.scope === "ai" ? "AI 资料" : selected.scope === "metadata" ? "影片资料" : "FFmpeg"} ·{" "}
              {selected.level === "error" ? "失败" : "成功"}
            </DialogDescription>
            <pre className="mt-5 max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/8 bg-black/30 p-4 font-mono text-xs leading-6 text-zinc-300">
              {selected.details ?? "没有附加详情"}
            </pre>
            <div className="mt-4 flex justify-end">
              <Button
                variant="secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(selected.details ?? selected.message)
                    .then(() => notify("日志内容已复制"))
                    .catch(() => notify("复制失败", true))
                }
              >
                复制内容
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AiCenterPage({
  snapshot,
  refresh,
  notify,
}: {
  snapshot: AppSnapshot;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [apiKey, setApiKey] = useState(snapshot.settings.deepSeekApiKey);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<AiUsageStats | null>(null);
  const loadStats = useCallback(
    () =>
      window.avault
        .getAiUsageStats()
        .then(setStats)
        .catch((error) => notify(errorMessage(error), true)),
    [notify],
  );
  useEffect(
    () => setApiKey(snapshot.settings.deepSeekApiKey),
    [snapshot.settings.deepSeekApiKey],
  );
  useEffect(() => {
    void loadStats();
  }, [loadStats]);
  async function save() {
    setSaving(true);
    try {
      await window.avault.setDeepSeekApiKey(apiKey);
      await refresh();
      notify(
        apiKey.trim() ? "DeepSeek API Key 已保存" : "DeepSeek API Key 已清除",
      );
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setSaving(false);
    }
  }
  const cards = [
    { label: "调用次数", value: stats?.requests ?? 0 },
    { label: "输入 Token", value: stats?.promptTokens ?? 0 },
    { label: "输出 Token", value: stats?.completionTokens ?? 0 },
    { label: "总 Token", value: stats?.totalTokens ?? 0 },
  ];
  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="flex items-start justify-between gap-5">
        <div>
          <h1 className="text-2xl font-bold">AI 中心</h1>
          <p className="mt-2 text-sm text-zinc-500">
            管理 DeepSeek 演员资料服务、联网来源与使用情况。
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadStats()}>
          <RefreshCw className="size-4" />
          刷新统计
        </Button>
      </div>
      <section className="mt-8 rounded-2xl border border-white/8 bg-white/[0.025] p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-sky-500/10 p-3">
            <Sparkles className="size-5 text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">DeepSeek</h2>
              {snapshot.settings.deepSeekApiKeyConfigured ? (
                <Badge className="border-0 bg-emerald-500/10 text-emerald-300">
                  API Key 已配置
                </Badge>
              ) : (
                <Badge className="border-0 bg-amber-500/10 text-amber-300">
                  尚未配置
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              模型使用{" "}
              <span className="font-mono text-zinc-400">deepseek-v4-flash</span>
              。获取资料时会先搜索公开网页，再由模型整理；无法确认的字段保持为空。
            </p>
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
              className="mt-4 font-mono text-xs"
              autoComplete="off"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" onClick={save} disabled={saving}>
                {saving && <LoaderCircle className="size-4 animate-spin" />}保存
              </Button>
              {snapshot.settings.deepSeekApiKeyConfigured && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setApiKey("");
                    void window.avault
                      .setDeepSeekApiKey("")
                      .then(refresh)
                      .then(() => notify("DeepSeek API Key 已清除"))
                      .catch((error) => notify(errorMessage(error), true));
                  }}
                >
                  清除
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
      <section className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="font-semibold">使用统计</h2>
            <p className="mt-1 text-sm text-zinc-500">
              采用每次 DeepSeek 响应返回的实际 usage 数据。
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-600">预估费用（USD）</div>
            <div className="mt-1 font-mono text-lg text-emerald-300">
              ${(stats?.estimatedUsd ?? 0).toFixed(4)}
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-4 gap-3">
          {cards.map((card) => (
            <div key={card.label} className="rounded-xl bg-black/20 p-4">
              <div className="text-xs text-zinc-600">{card.label}</div>
              <div className="mt-2 text-xl font-semibold text-zinc-100">
                {card.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-zinc-600">
          成功 {stats?.successfulRequests ?? 0} 次 · 失败{" "}
          {stats?.failedRequests ?? 0} 次。费用按 DeepSeek-V4-Flash
          当前公开单价估算：输入 $0.14 / 1M Token、输出 $0.28 / 1M
          Token；实际账单以 DeepSeek 为准。
        </p>
      </section>
      <section className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-6">
        <h2 className="font-semibold">联网资料流程</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          AVault 先搜索公开页面并提取摘要，然后将来源和内容交给
          DeepSeek。点击演员页的“AI 获取资料”后，可在“运行日志 → AI
          资料”核对来源、提示词和原始返回。
        </p>
      </section>
    </div>
  );
}

/* Legacy library-bound tool UI kept only as source context while the independent tool UI below replaces it.
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [outputName, setOutputName] = useState("合并影片");
  const [progress, setProgress] = useState<MergeProgress | null>(null);
  const files = useMemo(() => snapshot.movies.flatMap((movie) => movie.files.filter((file) => file.available).map((file) => ({ ...file, code: movie.normalizedCode ?? movie.code ?? movie.title }))).filter((file) => `${file.code} ${file.name}`.toLowerCase().includes(query.toLowerCase())), [snapshot.movies, query]);
  const selectedFiles = useMemo(() => snapshot.movies.flatMap((movie) => movie.files.filter((file) => selected.includes(file.id))), [snapshot.movies, selected]);
  const compatible = selectedFiles.length < 2 || selectedFiles.every((file) => {
    const first = selectedFiles[0].mediaInfo;
    const current = file.mediaInfo;
    return first && current && first.container === current.container && first.videoCodec === current.videoCodec && first.width === current.width && first.height === current.height && first.frameRate === current.frameRate && first.audioCodec === current.audioCodec && first.audioChannels === current.audioChannels;
  });
  useEffect(() => window.avault.onMergeProgress(setProgress), []);
  function toggle(fileId: string) { setSelected((current) => current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]); }
  function moveSelected(fileId: string, direction: -1 | 1) { setSelected((current) => { const index = current.indexOf(fileId); const next = index + direction; if (index < 0 || next < 0 || next >= current.length) return current; const reordered = [...current]; [reordered[index], reordered[next]] = [reordered[next], reordered[index]]; return reordered; }); }
  async function merge(mode: "copy" | "hevc") {
    if (selectedFiles.length < 2) return notify("请至少选择两个视频文件", true);
    if (new Set(selectedFiles.map((file) => file.libraryId)).size !== 1) return notify("请只选择同一个媒体文件夹内的文件", true);
    if (!outputName.trim()) return notify("请填写输出文件名", true);
    if (mode === "copy" && !compatible) return notify("无损合并要求编码、分辨率、帧率和音频参数一致；请改用转码合并", true);
    try { await window.avault.startMerge(selected, outputName.trim(), mode); await refresh(); notify("合并完成，已重新扫描媒体库"); setSelected([]); }
    catch (error) { notify(errorMessage(error), true); }
  }
  return <div className="mx-auto max-w-6xl px-8 py-8">
    <div className="flex items-start justify-between gap-5"><div><h1 className="text-2xl font-bold">工具箱</h1><p className="mt-1 text-sm text-zinc-600">合并同一影片的分段文件。默认无损，不会修改原始文件。</p></div><Badge className="border-violet-500/25 bg-violet-500/10 text-violet-200">FFmpeg</Badge></div>
    <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_360px]"><section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">选择并排序视频</h2><Input className="h-8 w-56" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索番号或文件名" /></div><p className="mt-1 text-xs text-zinc-600">选中的顺序即合并顺序；先选择的文件排在最前。</p><div className="mt-4 max-h-[52vh] overflow-y-auto rounded-xl border border-white/[0.07]">{files.map((file) => <button key={file.id} type="button" onClick={() => toggle(file.id)} className={cn("flex w-full items-center gap-3 border-b border-white/[0.055] px-4 py-3 text-left last:border-0", selected.includes(file.id) ? "bg-violet-500/10" : "hover:bg-white/[0.035]")}><span className={cn("grid size-5 place-items-center rounded border text-xs", selected.includes(file.id) ? "border-violet-400 bg-violet-500 text-white" : "border-zinc-700 text-transparent")}>✓</span><Video className="size-4 shrink-0 text-violet-300" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-zinc-200">{file.name}</span><span className="block truncate text-xs text-zinc-600">{file.code} · {formatBytes(file.size)} · {file.mediaInfo?.videoCodec?.toUpperCase() ?? "未检测"}</span></span>{selected.includes(file.id) && <span className="text-xs text-violet-200">第 {selected.indexOf(file.id) + 1} 段</span>}</button>)}{files.length === 0 && <div className="grid h-32 place-items-center text-sm text-zinc-600">没有匹配的视频</div>}</div></section>
    <aside className="h-fit rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><h2 className="font-semibold">合并设置</h2><div className="mt-4 text-sm text-zinc-400">已选择 <span className="font-semibold text-white">{selected.length}</span> 个文件</div>{selectedFiles.length > 0 && <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.07]">{selectedFiles.map((file, index) => <div key={file.id} className="flex items-center gap-2 border-b border-white/[0.055] px-2 py-2 text-xs last:border-0"><span className="text-violet-300">{index + 1}</span><span className="min-w-0 flex-1 truncate text-zinc-300">{file.name}</span><button type="button" disabled={index === 0} onClick={() => moveSelected(file.id, -1)} className="text-zinc-500 hover:text-white disabled:opacity-20"><ArrowUp className="size-3" /></button><button type="button" disabled={index === selectedFiles.length - 1} onClick={() => moveSelected(file.id, 1)} className="text-zinc-500 hover:text-white disabled:opacity-20"><ArrowDown className="size-3" /></button></div>)}</div>}<Input className="mt-4" value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="输出文件名" /><p className="mt-2 text-xs leading-5 text-zinc-600">输出到第一段视频的同级目录，扩展名固定为 .mp4；同名文件不会覆盖。</p><div className={cn("mt-4 rounded-lg border p-3 text-xs", compatible ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200" : "border-amber-500/20 bg-amber-500/[0.06] text-amber-200")}>{compatible ? "媒体参数一致：可无损合并。" : "媒体参数不同：无损合并不可用，建议使用转码合并。"}</div>{progress && <div className="mt-4 rounded-lg bg-black/20 p-3 text-xs text-zinc-400">{progress.state === "running" ? `正在合并 ${progress.percent?.toFixed(1) ?? 0}%${progress.speed ? ` · ${progress.speed}` : ""}` : progress.message}</div>}<div className="mt-5 space-y-2"><Button className="w-full" disabled={selected.length < 2 || !compatible || progress?.state === "running"} onClick={() => merge("copy")}>无损合并</Button><Button variant="outline" className="w-full" disabled={selected.length < 2 || progress?.state === "running" || !snapshot.settings.ffmpeg.nvencAvailable} onClick={() => merge("hevc")}>转码合并为 HEVC</Button></div><p className="mt-4 text-xs leading-5 text-zinc-600">转码合并使用 NVIDIA HEVC，输出约 2.5 Mbps；合并过程可在运行日志中查看完整命令。</p></aside></div></div>
}

*/
/* Compact initial independent tool implementation retained as a comment while the clearer panel below supersedes it.
  const [tab, setTab] = useState<"merge" | "transcode">("merge"); const [files, setFiles] = useState<ToolFile[]>([]); const [tasks, setTasks] = useState<ToolTask[]>([]); const [outputName, setOutputName] = useState("合并影片"); const [codec, setCodec] = useState<ToolEncodeOptions["codec"]>("hevc"); const [height, setHeight] = useState("保持原分辨率"); const [bitrate, setBitrate] = useState("2500");
  const options = (): ToolEncodeOptions => ({ codec, height: height === "保持原分辨率" ? null : Number(height), bitrateKbps: Number(bitrate) });
  const addPaths = async (paths: string[]) => { const added = await window.avault.inspectToolFiles(paths); setFiles((current) => [...current, ...added.filter((item) => !current.some((known) => known.path === item.path))]); };
  useEffect(() => { void window.avault.getToolTasks().then(setTasks); return window.avault.onToolTaskProgress((task) => setTasks((current) => { const index = current.findIndex((item) => item.id === task.id); return index < 0 ? [...current, task] : current.map((item) => item.id === task.id ? task : item); })); }, []);
  const compatible = files.length < 2 || files.every((file) => { const first = files[0].mediaInfo; const info = file.mediaInfo; return first && info && first.container === info.container && first.videoCodec === info.videoCodec && first.width === info.width && first.height === info.height && first.frameRate === info.frameRate && first.audioCodec === info.audioCodec && first.audioChannels === info.audioChannels; });
  const choose = async () => { const added = await window.avault.chooseToolFiles(); setFiles((current) => [...current, ...added.filter((item) => !current.some((known) => known.path === item.path))]); };
  const drop = async (event: React.DragEvent) => { event.preventDefault(); await addPaths(Array.from(event.dataTransfer.files).map((file) => window.avault.getDroppedFilePath(file)).filter(Boolean)); };
  const move = (index: number, direction: -1 | 1) => setFiles((current) => { const target = index + direction; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const runMerge = async (mode: "copy" | "transcode") => { if (files.length < 2 || !outputName.trim()) return notify("请添加至少两个文件并填写输出名称", true); if (mode === "copy" && !compatible) return notify("文件参数不一致，不能无损合并", true); try { await window.avault.startToolMerge(files.map((file) => file.path), outputName, mode, options()); notify("已加入工具箱任务队列"); } catch (error) { notify(errorMessage(error), true); } };
  const runTranscode = async () => { if (!files.length) return notify("请先添加视频文件", true); try { await window.avault.startToolTranscode(files.map((file) => file.path), options()); notify(`已加入 ${files.length} 个转码任务`); } catch (error) { notify(errorMessage(error), true); } };
  return <div className="mx-auto max-w-6xl px-8 py-8"><div className="flex items-start justify-between"><div><h1 className="text-2xl font-bold">工具箱</h1><p className="mt-1 text-sm text-zinc-600">独立处理本地视频，不关联 AVault 媒体库。</p></div><Badge className="border-violet-500/25 bg-violet-500/10 text-violet-200">FFmpeg</Badge></div><div className="mt-6 flex gap-2"><Button variant={tab === "merge" ? "default" : "outline"} onClick={() => setTab("merge")}>合并视频</Button><Button variant={tab === "transcode" ? "default" : "outline"} onClick={() => setTab("transcode")}>转码视频</Button></div><div onDragOver={(event) => event.preventDefault()} onDrop={drop} className="mt-5 grid min-h-36 place-items-center rounded-2xl border border-dashed border-violet-400/35 bg-violet-500/[0.04] p-6 text-center"><div><Video className="mx-auto size-7 text-violet-300" /><div className="mt-2 font-medium">拖入视频文件到这里</div><div className="mt-1 text-xs text-zinc-600">支持 MP4、MKV、AVI、MOV、WMV、M4V、TS</div><Button variant="outline" className="mt-3" onClick={choose}>选择文件</Button></div></div><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]"><section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">{tab === "merge" ? "合并顺序" : "待转码文件"}</h2><span className="text-xs text-zinc-600">{files.length} 个文件</span></div><div className="mt-3 max-h-[42vh] overflow-y-auto rounded-xl border border-white/[0.07]">{files.map((file, index) => <div key={file.path} className="flex items-center gap-3 border-b border-white/[0.055] px-3 py-3 last:border-0"><span className="w-5 text-center text-xs text-violet-300">{tab === "merge" ? index + 1 : ""}</span><Video className="size-4 text-violet-300" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{file.name}</span><span className="block text-xs text-zinc-600">{formatBytes(file.size)} · {file.mediaInfo?.videoCodec?.toUpperCase() ?? "未检测"} · {file.mediaInfo?.width ?? "?"}×{file.mediaInfo?.height ?? "?"}</span></span>{tab === "merge" && <><button disabled={index === 0} onClick={() => move(index, -1)} className="text-zinc-500 disabled:opacity-20"><ArrowUp className="size-4" /></button><button disabled={index === files.length - 1} onClick={() => move(index, 1)} className="text-zinc-500 disabled:opacity-20"><ArrowDown className="size-4" /></button></>}<button onClick={() => setFiles((current) => current.filter((item) => item.path !== file.path))} className="text-zinc-500 hover:text-rose-300"><X className="size-4" /></button></div>)}{files.length === 0 && <div className="grid h-40 place-items-center text-sm text-zinc-600">尚未添加文件</div>}</div></section><aside className="h-fit rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><h2 className="font-semibold">{tab === "merge" ? "合并设置" : "转码设置"}</h2>{tab === "merge" && <><Input className="mt-4" value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="输出文件名" /><div className={cn("mt-3 rounded-lg border p-3 text-xs", compatible ? "border-emerald-500/20 text-emerald-200" : "border-amber-500/20 text-amber-200")}>{compatible ? "参数一致，可无损合并。" : "参数不一致，请使用转码合并。"}</div></>}<div className="mt-4 grid grid-cols-2 gap-2"><Select value={codec} onValueChange={(value) => { setCodec(value as ToolEncodeOptions["codec"]); if (value === "h264" && bitrate === "2500") setBitrate("4000"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hevc">H.265 / HEVC</SelectItem><SelectItem value="h264">H.264</SelectItem></SelectContent></Select><Select value={height} onValueChange={setHeight}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="保持原分辨率">保持原分辨率</SelectItem><SelectItem value="720">720p</SelectItem><SelectItem value="1080">1080p</SelectItem></SelectContent></Select></div><Input className="mt-2" value={bitrate} onChange={(event) => setBitrate(event.target.value)} inputMode="numeric" placeholder="视频码率 kbps" /><p className="mt-2 text-xs text-zinc-600">音频固定 AAC 160 kbps / 双声道，输出为 MP4。</p>{tab === "merge" ? <div className="mt-5 space-y-2"><Button className="w-full" disabled={files.length < 2 || !compatible} onClick={() => runMerge("copy")}>无损合并</Button><Button variant="outline" className="w-full" disabled={files.length < 2 || !snapshot.settings.ffmpeg.nvencAvailable} onClick={() => runMerge("transcode")}>转码合并</Button></div> : <Button className="mt-5 w-full" disabled={!files.length || !snapshot.settings.ffmpeg.nvencAvailable} onClick={runTranscode}>加入转码队列</Button>}</aside></div><section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><h2 className="font-semibold">工具箱任务</h2><div className="mt-3 space-y-2">{tasks.slice().reverse().map((task) => <div key={task.id} className="flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{task.outputName}</span><span className="text-xs text-zinc-500">{task.state === "running" ? `${task.percent?.toFixed(1) ?? 0}% ${task.speed ?? ""}` : task.message ?? task.state}</span>{["queued", "running"].includes(task.state) ? <Button variant="ghost" size="sm" onClick={() => window.avault.cancelToolTask(task.id)}>取消</Button> : <Button variant="ghost" size="sm" onClick={() => window.avault.removeToolTask(task.id).then(() => setTasks((current) => current.filter((item) => item.id !== task.id)))}>移除</Button>}</div>)}{tasks.length === 0 && <div className="py-5 text-sm text-zinc-600">暂无工具箱任务</div>}</div></section></div>
}

*/
/* Previous compact rendition.
  const [tab, setTab] = useState<"merge" | "transcode">("merge");
  const [files, setFiles] = useState<ToolFile[]>([]); const [tasks, setTasks] = useState<ToolTask[]>([]);
  const [outputName, setOutputName] = useState("合并影片"); const [codec, setCodec] = useState<ToolEncodeOptions["codec"]>("hevc"); const [height, setHeight] = useState("keep"); const [bitrate, setBitrate] = useState("2500");
  const options = (): ToolEncodeOptions => ({ codec, height: height === "keep" ? null : Number(height), bitrateKbps: Number(bitrate) });
  const append = (incoming: ToolFile[]) => setFiles((current) => [...current, ...incoming.filter((item) => !current.some((known) => known.path === item.path))]);
  useEffect(() => { void window.avault.getToolTasks().then(setTasks); return window.avault.onToolTaskProgress((task) => setTasks((current) => { const i = current.findIndex((item) => item.id === task.id); return i < 0 ? [...current, task] : current.map((item) => item.id === task.id ? task : item); })); }, []);
  const compatible = files.length < 2 || files.every((file) => { const a = files[0].mediaInfo; const b = file.mediaInfo; return a && b && a.container === b.container && a.videoCodec === b.videoCodec && a.width === b.width && a.height === b.height && a.frameRate === b.frameRate && a.audioCodec === b.audioCodec && a.audioChannels === b.audioChannels; });
  const addDialog = async () => append(await window.avault.chooseToolFiles());
  const drop = async (event: React.DragEvent) => { event.preventDefault(); append(await window.avault.inspectToolFiles(Array.from(event.dataTransfer.files).map((file) => window.avault.getDroppedFilePath(file)))); };
  const move = (index: number, offset: -1 | 1) => setFiles((current) => { const next = index + offset; if (next < 0 || next >= current.length) return current; const result = [...current]; [result[index], result[next]] = [result[next], result[index]]; return result; });
  const queueMerge = async (mode: "copy" | "transcode") => { try { if (files.length < 2 || !outputName.trim()) throw new Error("请添加至少两个文件并填写输出名称"); if (mode === "copy" && !compatible) throw new Error("文件参数不一致，不能无损合并"); await window.avault.startToolMerge(files.map((file) => file.path), outputName, mode, options()); notify("已加入工具箱任务队列"); } catch (error) { notify(errorMessage(error), true); } };
  const queueTranscode = async () => { try { if (!files.length) throw new Error("请先添加视频文件"); await window.avault.startToolTranscode(files.map((file) => file.path), options()); notify(`已加入 ${files.length} 个转码任务`); } catch (error) { notify(errorMessage(error), true); } };
  const settings = <><div className="mt-5 border-t border-white/[0.07] pt-4"><div className="text-sm font-medium text-zinc-200">转码参数</div><p className="mt-1 text-xs leading-5 text-zinc-600">只在“转码合并”或“转码视频”时生效；无损合并不会重新编码。</p></div><label className="mt-4 block text-xs text-zinc-500">视频编码</label><Select value={codec} onValueChange={(value) => { setCodec(value as ToolEncodeOptions["codec"]); if (value === "h264" && bitrate === "2500") setBitrate("4000"); }}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hevc">H.265 / HEVC（体积更小）</SelectItem><SelectItem value="h264">H.264（兼容性更好）</SelectItem></SelectContent></Select><label className="mt-3 block text-xs text-zinc-500">输出分辨率</label><Select value={height} onValueChange={setHeight}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="keep">保持原分辨率</SelectItem><SelectItem value="720">最高 720p</SelectItem><SelectItem value="1080">最高 1080p</SelectItem></SelectContent></Select><label className="mt-3 block text-xs text-zinc-500">视频码率（kbps）</label><Input className="mt-1" value={bitrate} onChange={(event) => setBitrate(event.target.value)} inputMode="numeric" /><p className="mt-1 text-xs leading-5 text-zinc-600">数值越低，体积越小、画质越低。H.265 建议 2500；H.264 建议 4000。音频固定 AAC 160 kbps / 双声道。</p></>;
  return <div className="mx-auto max-w-6xl px-8 py-8"><div className="flex items-start justify-between"><div><h1 className="text-2xl font-bold">工具箱</h1><p className="mt-1 text-sm text-zinc-600">独立处理任意本地视频，不会写入媒体库。</p></div><Badge className="border-violet-500/25 bg-violet-500/10 text-violet-200">FFmpeg</Badge></div><div className="mt-6 flex rounded-xl border border-white/[0.08] bg-black/20 p-1"><Button size="sm" variant={tab === "merge" ? "default" : "ghost"} onClick={() => setTab("merge")}>合并视频</Button><Button size="sm" variant={tab === "transcode" ? "default" : "ghost"} onClick={() => setTab("transcode")}>转码视频</Button></div><div onDragOver={(event) => event.preventDefault()} onDrop={drop} className="mt-5 grid min-h-32 place-items-center rounded-2xl border border-dashed border-violet-400/35 bg-violet-500/[0.04] p-5 text-center"><div><Video className="mx-auto size-6 text-violet-300" /><div className="mt-2 text-sm font-medium">拖入视频文件，或从资源管理器选择</div><Button variant="outline" size="sm" className="mt-3" onClick={addDialog}>选择文件</Button></div></div><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]"><section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{tab === "merge" ? "合并顺序" : "待转码文件"}</h2><p className="mt-1 text-xs text-zinc-600">{tab === "merge" ? "数字决定播放与合并顺序，可用箭头调整。" : "每个文件会独立输出到自己的同级目录。"}</p></div><Badge variant="secondary">{files.length} 个</Badge></div><div className="mt-4 h-[40vh] overflow-y-auto rounded-xl border border-white/[0.07]">{files.map((file, index) => <div key={file.path} className="flex items-center gap-3 border-b border-white/[0.055] px-3 py-3 last:border-0"><span className="w-5 text-center text-xs text-violet-300">{tab === "merge" ? index + 1 : ""}</span><Video className="size-4 shrink-0 text-violet-300" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-zinc-200">{file.name}</span><span className="block text-xs text-zinc-600">{formatBytes(file.size)} · {file.mediaInfo?.videoCodec?.toUpperCase() ?? "未检测"} · {file.mediaInfo?.width ?? "?"}×{file.mediaInfo?.height ?? "?"}</span></span>{tab === "merge" && <><button disabled={!index} onClick={() => move(index, -1)} className="text-zinc-500 disabled:opacity-20"><ArrowUp className="size-4" /></button><button disabled={index === files.length - 1} onClick={() => move(index, 1)} className="text-zinc-500 disabled:opacity-20"><ArrowDown className="size-4" /></button></>}<button onClick={() => setFiles((current) => current.filter((item) => item.path !== file.path))} className="text-zinc-500 hover:text-rose-300"><X className="size-4" /></button></div>)}{!files.length && <div className="grid h-full place-items-center text-sm text-zinc-600">尚未添加文件</div>}</div></section><aside className="h-fit rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><h2 className="font-semibold">{tab === "merge" ? "合并设置" : "转码设置"}</h2>{tab === "merge" && <><label className="mt-4 block text-xs text-zinc-500">输出文件名</label><Input className="mt-1" value={outputName} onChange={(event) => setOutputName(event.target.value)} /><p className="mt-1 text-xs text-zinc-600">保存到第一段视频同级目录，不覆盖已有文件。</p><div className={cn("mt-4 rounded-xl border p-3 text-xs", compatible ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200" : "border-amber-500/25 bg-amber-500/[0.06] text-amber-200")}>{compatible ? "参数一致：可无损合并，速度快且不会损失画质。" : "参数不一致：请使用转码合并，将统一编码与分辨率。"}</div></>}{settings}{tab === "merge" ? <div className="mt-5 grid gap-2"><Button disabled={files.length < 2 || !compatible} onClick={() => queueMerge("copy")}>无损合并</Button><Button variant="outline" disabled={files.length < 2 || !snapshot.settings.ffmpeg.nvencAvailable} onClick={() => queueMerge("transcode")}>转码合并</Button></div> : <Button className="mt-5 w-full" disabled={!files.length || !snapshot.settings.ffmpeg.nvencAvailable} onClick={queueTranscode}>加入转码队列</Button>}</aside></div><section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><h2 className="font-semibold">工具箱任务</h2><div className="mt-3 space-y-2">{tasks.slice().reverse().map((task) => <div key={task.id} className="flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{task.outputName}</span><span className="text-xs text-zinc-500">{task.state === "running" ? `${task.percent?.toFixed(1) ?? 0}% ${task.speed ?? ""}` : task.message ?? task.state}</span>{["queued", "running"].includes(task.state) ? <Button variant="ghost" size="sm" onClick={() => window.avault.cancelToolTask(task.id)}>取消</Button> : <Button variant="ghost" size="sm" onClick={() => window.avault.removeToolTask(task.id).then(() => setTasks((current) => current.filter((item) => item.id !== task.id))}>移除</Button>}</div>)}{!tasks.length && <div className="py-5 text-sm text-zinc-600">暂无工具箱任务</div>}</div></section></div>
}

*/
/* Previous tools layout.
  const [tab, setTab] = useState<'merge' | 'transcode'>('merge')
  const [files, setFiles] = useState<ToolFile[]>([])
  const [outputName, setOutputName] = useState('合并影片')
  const [codec, setCodec] = useState<ToolEncodeOptions['codec']>('hevc')
  const [height, setHeight] = useState('keep')
  const [bitrate, setBitrate] = useState('2500')
  const options = (): ToolEncodeOptions => ({ codec, height: height === 'keep' ? null : Number(height), bitrateKbps: Number(bitrate) })
  const append = (added: ToolFile[]) => setFiles((current) => [...current, ...added.filter((item) => !current.some((known) => known.path === item.path))])
  const compatible = files.length < 2 || files.every((file) => { const a = files[0].mediaInfo; const b = file.mediaInfo; return Boolean(a && b && a.container === b.container && a.videoCodec === b.videoCodec && a.width === b.width && a.height === b.height && a.frameRate === b.frameRate && a.audioCodec === b.audioCodec && a.audioChannels === b.audioChannels) })
  const choose = async () => append(await window.avault.chooseToolFiles())
  const drop = async (event: React.DragEvent) => { event.preventDefault(); append(await window.avault.inspectToolFiles(Array.from(event.dataTransfer.files).map((file) => window.avault.getDroppedFilePath(file)))) }
  const run = async (mode: 'copy' | 'transcode') => { try { await window.avault.startToolMerge(files.map((file) => file.path), outputName, mode, options()); notify('已加入工具箱任务队列') } catch (error) { notify(errorMessage(error), true) } }
  const runTranscode = async () => { try { await window.avault.startToolTranscode(files.map((file) => file.path), options()); notify('已加入转码任务队列') } catch (error) { notify(errorMessage(error), true) } }
  return <div className="mx-auto max-w-6xl px-8 py-8"><h1 className="text-2xl font-bold">工具箱</h1><p className="mt-1 text-sm text-zinc-600">独立处理本地视频，不会写入 AVault 媒体库。</p><div className="mt-6 flex rounded-xl border border-white/[0.08] bg-black/20 p-1 w-fit"><Button size="sm" variant={tab === 'merge' ? 'default' : 'ghost'} onClick={() => setTab('merge')}>合并视频</Button><Button size="sm" variant={tab === 'transcode' ? 'default' : 'ghost'} onClick={() => setTab('transcode')}>转码视频</Button></div><div onDragOver={(event) => event.preventDefault()} onDrop={drop} className="mt-5 grid min-h-32 place-items-center rounded-2xl border border-dashed border-violet-400/35 bg-violet-500/[0.04] p-5 text-center"><div><Video className="mx-auto size-6 text-violet-300" /><div className="mt-2 text-sm font-medium">拖入视频文件到这里</div><Button variant="outline" size="sm" className="mt-3" onClick={choose}>选择文件</Button></div></div><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]"><section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{tab === 'merge' ? '合并顺序' : '待转码文件'}</h2><p className="mt-1 text-xs text-zinc-600">{tab === 'merge' ? '上方为第一段；可通过删除后重新添加调整顺序。' : '每个文件都会输出在自己的同级目录。'}</p></div><Badge variant="secondary">{files.length} 个</Badge></div><div className="mt-4 h-[40vh] overflow-y-auto rounded-xl border border-white/[0.07]">{files.map((file, index) => <div key={file.path} className="flex items-center gap-3 border-b border-white/[0.055] px-3 py-3 last:border-0"><span className="w-5 text-center text-xs text-violet-300">{tab === 'merge' ? index + 1 : ''}</span><Video className="size-4 text-violet-300" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{file.name}</span><span className="block text-xs text-zinc-600">{formatBytes(file.size)} · {file.mediaInfo?.videoCodec?.toUpperCase() ?? '未检测'} · {file.mediaInfo?.width ?? '?'}×{file.mediaInfo?.height ?? '?'}</span></span><button onClick={() => setFiles((current) => current.filter((item) => item.path !== file.path))} className="text-zinc-500 hover:text-rose-300"><X className="size-4" /></button></div>)}{files.length === 0 && <div className="grid h-full place-items-center text-sm text-zinc-600">尚未添加文件</div>}</div></section><aside className="h-fit rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><h2 className="font-semibold">{tab === 'merge' ? '合并设置' : '转码设置'}</h2>{tab === 'merge' && <><label className="mt-4 block text-xs text-zinc-500">输出文件名</label><Input className="mt-1" value={outputName} onChange={(event) => setOutputName(event.target.value)} /><div className={cn('mt-4 rounded-xl border p-3 text-xs', compatible ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200' : 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200')}>{compatible ? '参数一致：可无损合并，速度快且不损失画质。' : '参数不一致：请使用转码合并。'}</div></>}<div className="mt-5 border-t border-white/[0.07] pt-4"><div className="text-sm font-medium">转码参数</div><p className="mt-1 text-xs text-zinc-600">仅用于转码合并或转码视频；无损合并不会使用。</p></div><label className="mt-4 block text-xs text-zinc-500">视频编码</label><Select value={codec} onValueChange={(value) => setCodec(value as ToolEncodeOptions['codec'])}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hevc">H.265 / HEVC（体积更小）</SelectItem><SelectItem value="h264">H.264（兼容性更好）</SelectItem></SelectContent></Select><label className="mt-3 block text-xs text-zinc-500">输出分辨率</label><Select value={height} onValueChange={setHeight}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="keep">保持原分辨率</SelectItem><SelectItem value="720">最高 720p</SelectItem><SelectItem value="1080">最高 1080p</SelectItem></SelectContent></Select><label className="mt-3 block text-xs text-zinc-500">视频码率（kbps）</label><Input className="mt-1" value={bitrate} onChange={(event) => setBitrate(event.target.value)} inputMode="numeric" /><p className="mt-1 text-xs text-zinc-600">越低体积越小、画质越低。H.265 建议 2500；H.264 建议 4000。</p>{tab === 'merge' ? <div className="mt-5 grid gap-2"><Button disabled={files.length < 2 || !compatible} onClick={() => run('copy')}>无损合并</Button><Button variant="outline" disabled={files.length < 2 || !snapshot.settings.ffmpeg.nvencAvailable} onClick={() => run('transcode')}>转码合并</Button></div> : <Button className="mt-5 w-full" disabled={!files.length || !snapshot.settings.ffmpeg.nvencAvailable} onClick={runTranscode}>加入转码队列</Button>}</aside></div></div>
}

*/
/* Superseded by IndependentToolsPage in ToolboxPage.tsx.
  const [tab, setTab] = useState<'merge' | 'transcode' | 'probe'>('merge')
  const [files, setFiles] = useState<ToolFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [outputName, setOutputName] = useState('合并影片')
  const [codec, setCodec] = useState<ToolEncodeOptions['codec']>('hevc')
  const [height, setHeight] = useState('keep')
  const [bitrate, setBitrate] = useState('2500')
  const [tasks, setTasks] = useState<ToolTask[]>([])
  const options = (): ToolEncodeOptions => ({ codec, height: height === 'keep' ? null : Number(height), bitrateKbps: Number(bitrate) })
  const append = (added: ToolFile[]) => setFiles((current) => { const next = [...current, ...added.filter((item) => !current.some((known) => known.path === item.path))]; setSelectedPath(next[0]?.path ?? null); return next })
  const selected = files.find((file) => file.path === selectedPath) ?? files[0] ?? null
  const compatible = files.length < 2 || files.every((file) => { const a = files[0].mediaInfo; const b = file.mediaInfo; return Boolean(a && b && a.container === b.container && a.videoCodec === b.videoCodec && a.width === b.width && a.height === b.height && a.frameRate === b.frameRate && a.audioCodec === b.audioCodec && a.audioChannels === b.audioChannels) })
  useEffect(() => { void window.avault.getToolTasks().then(setTasks); return window.avault.onToolTaskProgress((task) => setTasks((current) => { const i = current.findIndex((item) => item.id === task.id); return i < 0 ? [...current, task] : current.map((item) => item.id === task.id ? task : item) })) }, [])
  const choose = async () => { append(await window.avault.chooseToolFiles()); setTab('probe') }
  const drop = async (event: React.DragEvent) => { event.preventDefault(); append(await window.avault.inspectToolFiles(Array.from(event.dataTransfer.files).map((file) => window.avault.getDroppedFilePath(file)))); setTab('probe') }
  const remove = (path: string) => setFiles((current) => current.filter((file) => file.path !== path))
  const queueMerge = async (mode: 'copy' | 'transcode') => { try { if (files.length < 2) throw new Error('请添加至少两个视频文件'); if (mode === 'copy' && !compatible) throw new Error('文件参数不一致，不能无损合并'); await window.avault.startToolMerge(files.map((file) => file.path), outputName, mode, options()); notify('已加入工具箱任务队列') } catch (error) { notify(errorMessage(error), true) } }
  const queueTranscode = async () => { try { if (!files.length) throw new Error('请先添加视频文件'); await window.avault.startToolTranscode(files.map((file) => file.path), options()); notify('已加入转码任务队列') } catch (error) { notify(errorMessage(error), true) } }
  const info = selected?.mediaInfo
  const rows: Array<[string, string]> = info ? [['容器', info.container ?? '未知'], ['视频编码', info.videoCodec?.toUpperCase() ?? '未知'], ['编码器', info.videoEncoder ?? '未知'], ['分辨率', info.width && info.height ? `${info.width} × ${info.height}` : '未知'], ['帧率', info.frameRate ? `${info.frameRate} fps` : '未知'], ['视频码率', info.videoBitrate ? `${Math.round(info.videoBitrate / 1000)} kbps` : '未知'], ['像素格式', info.pixelFormat ?? '未知'], ['HDR', info.hdr ? '是' : '否'], ['音频编码', info.audioCodec?.toUpperCase() ?? '无'], ['音频码率', info.audioBitrate ? `${Math.round(info.audioBitrate / 1000)} kbps` : '未知'], ['音频声道', info.audioChannels ? `${info.audioChannels} 声道` : '未知'], ['时长', info.durationSeconds ? `${Math.floor(info.durationSeconds / 60)} 分 ${Math.round(info.durationSeconds % 60)} 秒` : '未知']] : []
  return <div className="mx-auto max-w-6xl px-8 py-8"><div className="flex items-start justify-between"><div><h1 className="text-2xl font-bold">工具箱</h1><p className="mt-1 text-sm text-zinc-600">拖入任意本地视频；不关联 AVault 媒体库。</p></div><Badge>FFprobe + FFmpeg</Badge></div><div className="mt-6 flex w-fit rounded-xl border border-white/[0.08] bg-black/20 p-1"><Button size="sm" variant={tab === 'merge' ? 'default' : 'ghost'} onClick={() => setTab('merge')}>合并视频</Button><Button size="sm" variant={tab === 'transcode' ? 'default' : 'ghost'} onClick={() => setTab('transcode')}>转码视频</Button><Button size="sm" variant={tab === 'probe' ? 'default' : 'ghost'} onClick={() => setTab('probe')}>媒体检测</Button></div><div onDragOver={(event) => event.preventDefault()} onDrop={drop} className="mt-5 grid min-h-32 place-items-center rounded-2xl border border-dashed border-violet-400/35 bg-violet-500/[0.04] p-5 text-center"><div><Video className="mx-auto size-6 text-violet-300" /><p className="mt-2 text-sm font-medium">拖入视频文件到这里</p><Button variant="outline" size="sm" className="mt-3" onClick={choose}>选择文件</Button></div></div><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]"><section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{tab === 'probe' ? '已检测文件' : tab === 'merge' ? '合并顺序' : '待转码文件'}</h2><p className="mt-1 text-xs text-zinc-600">点击文件可查看完整媒体参数。</p></div><Badge>{files.length} 个</Badge></div><div className="mt-4 h-[40vh] overflow-y-auto rounded-xl border border-white/[0.07]">{files.map((file, index) => <button key={file.path} type="button" onClick={() => { setSelectedPath(file.path); setTab('probe') }} className={cn('flex w-full items-center gap-3 border-b border-white/[0.055] px-3 py-3 text-left last:border-0', selected?.path === file.path ? 'bg-violet-500/10' : 'hover:bg-white/[0.035]')}><span className="w-5 text-center text-xs text-violet-300">{tab === 'merge' ? index + 1 : ''}</span><Video className="size-4 shrink-0 text-violet-300" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{file.name}</span><span className="block text-xs text-zinc-600">{formatBytes(file.size)} · {file.mediaInfo?.videoCodec?.toUpperCase() ?? '未检测'} · {file.mediaInfo?.width ?? '?'}×{file.mediaInfo?.height ?? '?'}</span></span><span onClick={(event) => { event.stopPropagation(); remove(file.path) }} className="text-zinc-500 hover:text-rose-300"><X className="size-4" /></span></button>)}{!files.length && <div className="grid h-full place-items-center text-sm text-zinc-600">尚未添加文件</div>}</div></section><aside className="h-fit rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">{tab === 'probe' ? <><h2 className="font-semibold">媒体参数</h2>{selected ? <><p className="mt-2 truncate text-xs text-zinc-500">{selected.name}</p><div className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.07]">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 px-3 py-2 text-xs"><span className="text-zinc-500">{label}</span><span className="text-right text-zinc-200">{value}</span></div>)}</div></> : <p className="mt-4 text-sm text-zinc-600">拖入文件后，FFprobe 会自动分析参数。</p>}</> : <><h2 className="font-semibold">{tab === 'merge' ? '合并设置' : '转码设置'}</h2>{tab === 'merge' && <><label className="mt-4 block text-xs text-zinc-500">输出文件名</label><Input className="mt-1" value={outputName} onChange={(event) => setOutputName(event.target.value)} /><div className={cn('mt-4 rounded-xl border p-3 text-xs', compatible ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200' : 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200')}>{compatible ? '参数一致：可无损合并。' : '参数不一致：请使用转码合并。'}</div></>}<label className="mt-4 block text-xs text-zinc-500">视频编码</label><Select value={codec} onValueChange={(value) => setCodec(value as ToolEncodeOptions['codec'])}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hevc">H.265 / HEVC（体积更小）</SelectItem><SelectItem value="h264">H.264（兼容性更好）</SelectItem></SelectContent></Select><label className="mt-3 block text-xs text-zinc-500">输出分辨率</label><Select value={height} onValueChange={setHeight}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="keep">保持原分辨率</SelectItem><SelectItem value="720">最高 720p</SelectItem><SelectItem value="1080">最高 1080p</SelectItem></SelectContent></Select><label className="mt-3 block text-xs text-zinc-500">视频码率（kbps）</label><Input className="mt-1" value={bitrate} onChange={(event) => setBitrate(event.target.value)} /><p className="mt-1 text-xs text-zinc-600">数值越低，体积越小、画质也越低。</p>{tab === 'merge' ? <div className="mt-5 grid gap-2"><Button disabled={files.length < 2 || !compatible} onClick={() => queueMerge('copy')}>无损合并</Button><Button variant="outline" disabled={files.length < 2 || !snapshot.settings.ffmpeg.nvencAvailable} onClick={() => queueMerge('transcode')}>转码合并</Button></div> : <Button className="mt-5 w-full" disabled={!files.length || !snapshot.settings.ffmpeg.nvencAvailable} onClick={queueTranscode}>加入转码队列</Button>}</>}</aside></div><section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><h2 className="font-semibold">工具箱任务</h2><div className="mt-3 space-y-2">{tasks.map((task) => <div key={task.id} className="flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{task.outputName}</span><span className="text-xs text-zinc-500">{task.state === 'running' ? `${task.percent?.toFixed(1) ?? 0}%` : task.message ?? task.state}</span></div>)}{!tasks.length && <div className="text-sm text-zinc-600">暂无工具箱任务</div>}</div></section></div>
}

*/
function SettingsPage({
  snapshot,
  refresh,
  notify,
}: {
  snapshot: AppSnapshot;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  async function choose() {
    try {
      const path = await window.avault.choosePotPlayer();
      if (path) {
        await refresh();
        notify("PotPlayer 路径已保存");
      }
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  const [fc2Cookie, setFc2Cookie] = useState(snapshot.settings.fc2Cookie);
  const [savingFc2Cookie, setSavingFc2Cookie] = useState(false);
  useEffect(
    () => setFc2Cookie(snapshot.settings.fc2Cookie),
    [snapshot.settings.fc2Cookie],
  );
  async function saveFc2Cookie() {
    setSavingFc2Cookie(true);
    try {
      await window.avault.setFc2Cookie(fc2Cookie);
      await refresh();
      notify(
        fc2Cookie.trim()
          ? "FC2 Cookie 已保存并同步到 FC2 会话"
          : "FC2 Cookie 已清除",
      );
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setSavingFc2Cookie(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold">设置</h1>
      <p className="mt-2 text-sm text-zinc-500">管理播放器和元数据服务。</p>
      <div className="mt-8 space-y-4">
        <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-violet-500/10 p-3">
              <Play className="size-5 text-violet-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">PotPlayer</h2>
              <p className="mt-1 text-sm text-zinc-500">
                电脑端点击播放时使用的默认播放器。
              </p>
              <div className="mt-4 flex items-center gap-3">
                <div className="min-w-0 flex-1 truncate rounded-lg bg-black/20 px-3 py-2 text-xs text-zinc-400">
                  {snapshot.settings.potPlayerPath ?? "尚未检测到 PotPlayer"}
                </div>
                <Button variant="secondary" onClick={choose}>
                  选择程序
                </Button>
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-emerald-500/10 p-3">
              <Video className="size-5 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">FFmpeg 与 NVIDIA 转码</h2>
              <p className="mt-1 text-sm text-zinc-500">
                转码使用系统 PATH 中的 ffmpeg.exe / ffprobe.exe，并优先调用
                NVIDIA HEVC NVENC。
              </p>
              <div className="mt-4 rounded-lg bg-black/20 px-3 py-2 text-xs">
                <div
                  className={
                    snapshot.settings.ffmpeg.available &&
                    snapshot.settings.ffmpeg.nvencAvailable
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }
                >
                  {snapshot.settings.ffmpeg.available &&
                  snapshot.settings.ffmpeg.nvencAvailable
                    ? "FFmpeg 与 HEVC NVENC 已可用"
                    : (snapshot.settings.ffmpeg.message ?? "转码不可用")}
                </div>
                {snapshot.settings.ffmpeg.version && (
                  <div className="mt-1 truncate text-zinc-600">
                    {snapshot.settings.ffmpeg.version}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-amber-500/10 p-3">
              <Sparkles className="size-5 text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">影片元数据</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                普通番号使用 JavBus；FC2-PPV 使用 FC2 商品页。演员头像由
                Gfriends 单独获取，演员资料由 DeepSeek
                单独整理。只有主动点击操作时才会访问网络。
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-700">
                    JavBus
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-zinc-400">
                    {snapshot.settings.javBusBaseUrl}
                  </div>
                </div>
                <div className="rounded-lg bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-700">
                    FC2
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {snapshot.settings.fc2CookieConfigured
                      ? "Cookie 已配置"
                      : "尚未配置"}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-200">
                      FC2 Cookie
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-600">
                      粘贴浏览器已登录 FC2 请求中的完整{" "}
                      <span className="font-mono text-zinc-500">Cookie</span>{" "}
                      请求头。内容以明文保存在这台电脑，并会在这里保持可见。
                    </p>
                  </div>
                  {snapshot.settings.fc2CookieConfigured && (
                    <Badge className="border-0 bg-emerald-500/10 text-emerald-300">
                      已配置
                    </Badge>
                  )}
                </div>
                <Textarea
                  value={fc2Cookie}
                  onChange={(event) => setFc2Cookie(event.target.value)}
                  placeholder="name=value; name2=value2"
                  className="mt-3 min-h-32 font-mono text-xs"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={saveFc2Cookie}
                    disabled={savingFc2Cookie}
                  >
                    {savingFc2Cookie && (
                      <LoaderCircle className="size-4 animate-spin" />
                    )}
                    保存
                  </Button>
                  {snapshot.settings.fc2CookieConfigured && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setFc2Cookie("");
                        void window.avault
                          .setFc2Cookie("")
                          .then(refresh)
                          .then(() => notify("FC2 Cookie 已清除"))
                          .catch((error) => notify(errorMessage(error), true));
                      }}
                    >
                      清除
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [section, setSection] = useState<Section>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("added-desc");
  const [watchFilter, setWatchFilter] = useState<"all" | WatchStatus>("all");
  const [sourcePartitionFilter, setSourcePartitionFilter] = useState<"all" | SourcePartition>("all");
  const [libraryUnidentifiedOnly, setLibraryUnidentifiedOnly] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [gridCoverMode, setGridCoverMode] =
    useState<GridCoverMode>("landscape");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actorPage, setActorPage] = useState<{
    name: string;
    sourceMovieId: string | null;
  } | null>(null);
  const [tagPage, setTagPage] = useState<{
    name: string;
    sourceMovieId: string;
  } | null>(null);
  const [scanProgress, setScanProgress] = useState<
    Record<string, ScanProgress>
  >({});
  const [metadataBatchProgress, setMetadataBatchProgress] = useState<
    Record<string, MetadataBatchProgress>
  >({});
  const [metadataBatchAllRunning, setMetadataBatchAllRunning] = useState(false);
  const [organizePreview, setOrganizePreview] =
    useState<OrganizePreview | null>(null);
  const [organizePreviewFilter, setOrganizePreviewFilter] = useState<
    "all" | "move" | "skip" | "cleanup"
  >("all");
  const [organizeProgress, setOrganizeProgress] =
    useState<OrganizeProgress | null>(null);
  const [transcodeTasks, setTranscodeTasks] = useState<TranscodeProgress[]>([]);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const libraryScrollRef = useRef(0);
  const actorScrollRef = useRef(0);
  const tagScrollRef = useRef(0);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(
    async () => setSnapshot(await window.avault.getSnapshot()),
    [],
  );
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const preferences = snapshot.settings.homePreferences;
    setSort(preferences.sort);
    setWatchFilter(preferences.watchFilter);
    setView(preferences.view);
    setGridCoverMode(preferences.gridCoverMode);
  }, [snapshot?.settings.homePreferences]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [moreMenuOpen]);

  const updateHomePreferences = (patch: Partial<{ sort: SortMode; watchFilter: "all" | WatchStatus; view: "grid" | "list"; gridCoverMode: GridCoverMode }>) => {
    const next = { sort, watchFilter, view, gridCoverMode, ...patch };
    setSort(next.sort);
    setWatchFilter(next.watchFilter);
    setView(next.view);
    setGridCoverMode(next.gridCoverMode);
    void window.avault.setHomePreferences(next).catch((error) => notify(errorMessage(error), true));
  };

  useEffect(() => {
    refresh().catch((error) => notify(errorMessage(error), true));
    const unsubscribeScan = window.avault.onScanProgress((progress) => {
      setScanProgress((current) => ({
        ...current,
        [progress.libraryId]: progress,
      }));
      if (progress.phase === "complete") void refresh();
      if (progress.phase === "error")
        notify(progress.message ?? "扫描失败", true);
    });
    const unsubscribeMetadataBatch = window.avault.onMetadataBatchProgress(
      (progress) => {
        setMetadataBatchProgress((current) => ({
          ...current,
          [progress.libraryId]: progress,
        }));
        // A batch item is committed before its cover finishes downloading, so
        // refresh on progress updates to show the new text metadata and cover
        // as soon as each becomes available.
        void refresh();
      },
    );
    const unsubscribeOrganize = window.avault.onOrganizeProgress((progress) => {
      setOrganizeProgress(progress);
      if (progress.phase === "complete" || progress.phase === "cancelled")
        void refresh();
    });
    void window.avault
      .getTranscodeTasks()
      .then(setTranscodeTasks)
      .catch(() => undefined);
    const unsubscribeTranscode = window.avault.onTranscodeProgress(
      (progress) => {
        setTranscodeTasks((current) => {
          const index = current.findIndex(
            (task) =>
              task.fileId === progress.fileId && task.kind === progress.kind,
          );
          if (index < 0) return [...current, progress];
          const next = [...current];
          next[index] = progress;
          return next;
        });
        if (progress.state === "completed") void refresh();
      },
    );
    return () => {
      unsubscribeScan();
      unsubscribeMetadataBatch();
      unsubscribeOrganize();
      unsubscribeTranscode();
    };
  }, [refresh, notify]);

  const movies = useMemo(() => {
    if (!snapshot) return [];
    const needle = search.trim().toLocaleLowerCase();
    let result = snapshot.movies.filter((movie) => {
      if (section === "uncrawled" && hasMovieMetadata(movie)) return false;
      if (section === "unidentified" && movie.normalizedCode) return false;
      if (
        section.startsWith("library:") &&
        !movie.files.some((file) => file.libraryId === section.slice(8))
      )
        return false;
      if (libraryUnidentifiedOnly && section.startsWith("library:") && !movie.files.some((file) => file.libraryId === section.slice(8) && !file.codeRecognized))
        return false;
      if (watchFilter !== "all" && movie.watchStatus !== watchFilter)
        return false;
      if (sourcePartitionFilter !== "all" && movie.sourcePartition !== sourcePartitionFilter)
        return false;
      return (
        !needle ||
        [movie.code, movie.title, ...movie.actors].some((value) =>
          value?.toLocaleLowerCase().includes(needle),
        )
      );
    });
    return result.sort((a, b) => {
      if (sort === "added-asc") return a.createdAt.localeCompare(b.createdAt);
      if (sort === "code-asc")
        return (a.code ?? "").localeCompare(b.code ?? "");
      if (sort === "title-asc") return a.title.localeCompare(b.title);
      if (sort === "release-desc" || sort === "release-asc") {
        if (!a.releaseDate && !b.releaseDate)
          return b.createdAt.localeCompare(a.createdAt);
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return sort === "release-desc"
          ? b.releaseDate.localeCompare(a.releaseDate)
          : a.releaseDate.localeCompare(b.releaseDate);
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [snapshot, section, search, sort, watchFilter, libraryUnidentifiedOnly, sourcePartitionFilter]);

  const selectedMovie =
    snapshot?.movies.find((movie) => movie.id === selectedId) ?? null;
  const actorMovies = useMemo(() => {
    if (!snapshot || !actorPage) return [];
    return snapshot.movies
      .filter((movie) => movie.actors.includes(actorPage.name))
      .sort(
        (a, b) =>
          (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }, [snapshot, actorPage]);
  const tagMovies = useMemo(() => {
    if (!snapshot || !tagPage) return [];
    return snapshot.movies
      .filter((movie) => movie.tags.includes(tagPage.name))
      .sort(
        (a, b) =>
          (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") ||
          b.createdAt.localeCompare(a.createdAt),
      );
  }, [snapshot, tagPage]);
  const actors = useMemo(() => {
    if (!snapshot) return [];
    const counts = new Map<string, number>();
    for (const movie of snapshot.movies) {
      for (const actor of new Set(
        movie.actors.map((name) => name.trim()).filter(Boolean),
      ))
        counts.set(actor, (counts.get(actor) ?? 0) + 1);
    }
    return [...counts]
      .map(([name, movieCount]) => ({ name, movieCount }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [snapshot]);
  const activeLibrary = section.startsWith("library:")
    ? snapshot?.libraries.find((library) => library.id === section.slice(8))
    : null;
  const activeLibraryUnidentified = activeLibrary
    ? snapshot?.movies.filter((movie) => movie.files.some((file) => file.libraryId === activeLibrary.id && !file.codeRecognized)).length ?? 0
    : 0;
  const activeMetadataBatch = Object.values(metadataBatchProgress).find(
    (progress) => ["starting", "processing"].includes(progress.phase),
  );
  const title =
    section === "all"
      ? "全部影片"
      : section === "uncrawled"
        ? "未获取资料"
        : section === "unidentified"
          ? "未识别影片"
          : (activeLibrary?.name ?? "AVault");

  function scrollMainTo(top: number) {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => mainRef.current?.scrollTo({ top })),
    );
  }

  function navigate(next: Section) {
    setSelectedId(null);
    setActorPage(null);
    setTagPage(null);
    setLibraryUnidentifiedOnly(false);
    setSection(next);
    scrollMainTo(0);
  }

  function openMovie(id: string) {
    libraryScrollRef.current = mainRef.current?.scrollTop ?? 0;
    setActorPage(null);
    setTagPage(null);
    setSelectedId(id);
    scrollMainTo(0);
  }

  function backToLibrary() {
    if (actorPage) {
      setSelectedId(null);
      scrollMainTo(actorScrollRef.current);
      return;
    }
    if (tagPage) {
      setSelectedId(null);
      scrollMainTo(tagScrollRef.current);
      return;
    }
    setSelectedId(null);
    scrollMainTo(libraryScrollRef.current);
  }

  function openActor(actor: string) {
    if (!selectedId) return;
    setTagPage(null);
    setActorPage({ name: actor, sourceMovieId: selectedId });
    setSelectedId(null);
    scrollMainTo(0);
  }

  function closeActorPage() {
    const sourceMovieId = actorPage?.sourceMovieId;
    setActorPage(null);
    if (sourceMovieId) setSelectedId(sourceMovieId);
    else setSection("actors");
    scrollMainTo(0);
  }

  function openActorLibraryEntry(actor: string) {
    setSelectedId(null);
    setTagPage(null);
    setActorPage({ name: actor, sourceMovieId: null });
    scrollMainTo(0);
  }

  function openActorMovie(id: string) {
    actorScrollRef.current = mainRef.current?.scrollTop ?? 0;
    setSelectedId(id);
    scrollMainTo(0);
  }

  function openTag(tag: string) {
    if (!selectedId) return;
    setActorPage(null);
    setTagPage({ name: tag, sourceMovieId: selectedId });
    setSelectedId(null);
    scrollMainTo(0);
  }

  function closeTagPage() {
    const sourceMovieId = tagPage?.sourceMovieId;
    setTagPage(null);
    if (sourceMovieId) setSelectedId(sourceMovieId);
    scrollMainTo(0);
  }

  function openTagMovie(id: string) {
    tagScrollRef.current = mainRef.current?.scrollTop ?? 0;
    setSelectedId(id);
    scrollMainTo(0);
  }

  async function playMovieFromCard(id: string) {
    try {
      const result = await window.avault.playMovie(id);
      if (result.needsFileChoice)
        notify("该影片有多个文件，请进入详情页选择要播放的文件");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  async function addLibrary() {
    try {
      const library = await window.avault.addLibrary();
      if (library) {
        await refresh();
        navigate(`library:${library.id}`);
        notify("媒体目录已添加，正在扫描");
      }
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  async function scan(library: LibraryRecord) {
    try {
      await window.avault.scanLibrary(library.id);
      await refresh();
      notify(`“${library.name}”扫描完成`);
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  async function setLibraryPartition(library: LibraryRecord, value: string) {
    try {
      const result = await window.avault.setLibrarySourcePartition(library.id, value === "auto" ? null : value as SourcePartition);
      await refresh();
      notify(`${value === "auto" ? "已改为自动判断片源分区" : `已回填 ${result.updated} 部影片`}${result.sidecarFailed ? `，${result.sidecarFailed} 个 JSON 写入失败` : ""}`, result.sidecarFailed > 0);
    } catch (error) { notify(errorMessage(error), true); }
  }
  async function batchFetchMetadata(library: LibraryRecord) {
    const total =
      snapshot?.movies.filter(
        (movie) =>
          !hasMovieMetadata(movie) &&
          Boolean(movie.normalizedCode ?? movie.code) &&
          movie.files.some((file) => file.libraryId === library.id),
      ).length ?? 0;
    if (total === 0) {
      notify("没有需要爬取资料的影片");
      return;
    }
    if (
      !confirm(
        `将依次爬取 ${total} 部未获取资料的影片。\n\n为降低被 JavBus 限流的风险，每部影片之间会等待约 5–7 秒；连续 3 次失败会自动停止。确定开始吗？`,
      )
    )
      return;
    try {
      const result = await window.avault.batchFetchMetadata(library.id);
      await refresh();
      notify(
        result.message ??
          `批量爬取完成：成功 ${result.succeeded} 部，未收录 ${result.notFound} 部，失败 ${result.failed} 部`,
        result.phase === "stopped",
      );
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  async function batchFetchAllMetadata() {
    if (!snapshot) return;
    const pendingMovies = snapshot.movies.filter(
      (movie) =>
        !hasMovieMetadata(movie) &&
        Boolean(movie.normalizedCode ?? movie.code) &&
        movie.files.some((file) =>
          snapshot.libraries.some((library) => library.id === file.libraryId),
        ),
    );
    if (pendingMovies.length === 0) {
      notify("没有需要爬取资料的影片");
      return;
    }
    const targetLibraries = snapshot.libraries.filter((library) =>
      pendingMovies.some((movie) =>
        movie.files.some((file) => file.libraryId === library.id),
      ),
    );
    if (
      !confirm(
        `将按媒体文件夹依次爬取 ${pendingMovies.length} 部未获取资料的影片。\n\n每部影片之间会等待约 5–7 秒；连续 3 次失败会自动停止。确定开始吗？`,
      )
    )
      return;

    setMetadataBatchAllRunning(true);
    let succeeded = 0;
    let notFound = 0;
    let failed = 0;
    let stopped = false;
    try {
      for (let index = 0; index < targetLibraries.length; index += 1) {
        const result = await window.avault.batchFetchMetadata(
          targetLibraries[index].id,
        );
        succeeded += result.succeeded;
        notFound += result.notFound;
        failed += result.failed;
        await refresh();
        if (result.phase === "stopped") {
          stopped = true;
          break;
        }
        if (index < targetLibraries.length - 1)
          await new Promise((resolveDelay) =>
            window.setTimeout(resolveDelay, 5_000),
          );
      }
      notify(
        stopped
          ? `批量爬取已暂停：成功 ${succeeded} 部，未收录 ${notFound} 部，失败 ${failed} 部`
          : `批量爬取完成：成功 ${succeeded} 部，未收录 ${notFound} 部，失败 ${failed} 部`,
        stopped,
      );
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setMetadataBatchAllRunning(false);
    }
  }
  async function exportLocalJson(library: LibraryRecord) {
    if (!confirm(`将为“${library.name}”内每部影片写入同级 .avault.json。\n\n它会保存影片资料、演员、标签和当前封面文件名，重新扫描到空数据库时可自动恢复；不会移动、删除视频或图片。确定继续吗？`)) return;
    try {
      const result = await window.avault.exportLocalJson(library.id);
      notify(result.failed > 0 ? `本地 JSON 写入完成：成功 ${result.exported} 部，失败 ${result.failed} 部。${result.errors[0] ?? ""}` : `本地 JSON 写入完成：成功 ${result.exported} 部`, result.failed > 0);
    } catch (error) { notify(errorMessage(error), true); }
  }
  async function previewOrganize(library: LibraryRecord) {
    try {
      setOrganizeProgress(null);
      setOrganizePreviewFilter("all");
      setOrganizePreview(
        await window.avault.previewOrganizeLibrary(library.id),
      );
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  async function runOrganize() {
    if (!organizePreview) return;
    try {
      setOrganizeProgress({
        libraryId: organizePreview.libraryId,
        total: organizePreview.movable,
        completed: 0,
        moved: 0,
        skipped: organizePreview.skipped,
        phase: "moving",
      });
      await window.avault.organizeLibrary(organizePreview.libraryId);
    } catch (error) {
      notify(errorMessage(error), true);
      setOrganizeProgress(null);
    }
  }
  function closeOrganizeDialog() {
    if (organizeProgress?.phase === "moving") return;
    setOrganizePreview(null);
    setOrganizeProgress(null);
    setOrganizePreviewFilter("all");
  }
  async function remove(library: LibraryRecord) {
    if (
      !confirm(
        `从 AVault 移除“${library.name}”？\n磁盘中的原始文件不会被删除。`,
      )
    )
      return;
    try {
      await window.avault.removeLibrary(library.id);
      navigate("all");
      await refresh();
      notify("媒体目录已移除");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  if (!snapshot)
    return (
      <div className="flex h-screen items-center justify-center bg-[#0e0f12] text-zinc-500">
        <LoaderCircle className="mr-3 size-5 animate-spin text-violet-500" />
        正在打开媒体库…
      </div>
    );

  return (
    <div className="noise-bg relative h-screen overflow-hidden bg-[#0e0f12] text-zinc-100">
      <div
        className="app-titlebar absolute inset-x-0 top-0 z-50 h-8 border-b border-white/[0.055] bg-[#0e0f12]/90 backdrop-blur-xl"
        aria-hidden="true"
      />
      <div className="app-window-controls absolute right-0 top-0 z-[60] flex h-8">
        <button
          type="button"
          aria-label="最小化"
          onClick={() => window.avault.minimizeWindow()}
          className="flex w-11 items-center justify-center text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="最大化或还原"
          onClick={() => window.avault.toggleMaximizeWindow()}
          className="flex w-11 items-center justify-center text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          <Square className="size-3" strokeWidth={1.6} />
        </button>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => window.avault.closeWindow()}
          className="flex w-11 items-center justify-center text-zinc-400 transition hover:bg-red-600 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex h-full pt-8">
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/[0.065] bg-[#111216]/90 px-3 pb-4 pt-5 backdrop-blur">
          <div className="flex items-center gap-3 px-3">
            <img
              src={appIcon}
              alt="AVault"
              className="size-10 rounded-xl shadow-lg shadow-violet-900/30"
            />
            <div>
              <div className="font-bold tracking-tight">AVault</div>
              <div className="text-[10px] uppercase tracking-[.2em] text-zinc-600">
                Private Library
              </div>
            </div>
          </div>
          <Button onClick={addLibrary} className="mx-2 mt-6">
            <Plus className="size-4" />
            添加媒体文件夹
          </Button>
          <nav className="mt-6 space-y-1">
            {(
              [
                ["all", Archive, "全部影片", snapshot.movies.length],
                [
                  "uncrawled",
                  Sparkles,
                  "未获取资料",
                  snapshot.movies.filter((m) => !hasMovieMetadata(m)).length,
                ],
                [
                  "unidentified",
                  CircleAlert,
                  "未识别",
                  snapshot.movies.filter((m) => !m.normalizedCode).length,
                ],
                ["actors", Users, "演员库", actors.length],
              ] as const
            ).map(([key, Icon, label, count]) => (
              <button
                key={key}
                onClick={() => navigate(key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  section === key && !selectedMovie
                    ? "bg-violet-500/12 text-violet-200"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
                )}
              >
                <Icon className="size-4" />
                <span className="flex-1 text-left">{label}</span>
                <span className="text-xs text-zinc-600">{count}</span>
              </button>
            ))}
          </nav>
          <div className="mt-7 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-700">
            媒体文件夹
          </div>
          <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {snapshot.libraries.map((library) => (
              <button
                key={library.id}
                onClick={() => navigate(`library:${library.id}`)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                  section === `library:${library.id}` && !selectedMovie
                    ? "bg-white/7 text-white"
                    : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
                )}
              >
                <Folder className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {library.name}
                </span>
                <span className="text-xs text-zinc-700">
                  {library.movieCount}
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-1 border-t border-white/6 pt-3">
            <button
              onClick={() => navigate("tools")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                section === "tools" && !selectedMovie
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
              )}
            >
              <Wrench className="size-4" />
              工具箱
            </button>
            <button
              onClick={() => navigate("tasks")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                section === "tasks" && !selectedMovie
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
              )}
            >
              <Archive className="size-4" />
              任务
              {transcodeTasks.filter(
                (task) => task.state === "queued" || task.state === "running",
              ).length > 0 && (
                <Badge className="ml-auto border-0 bg-violet-500/15 px-1.5 py-0 text-[10px] text-violet-300">
                  {
                    transcodeTasks.filter(
                      (task) =>
                        task.state === "queued" || task.state === "running",
                    ).length
                  }
                </Badge>
              )}
            </button>
            <button
              onClick={() => navigate("ai")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                section === "ai" && !selectedMovie
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
              )}
            >
              <Sparkles className="size-4" />
              AI 中心
            </button>
            <button
              onClick={() => navigate("logs")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                section === "logs" && !selectedMovie
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
              )}
            >
              <CircleAlert className="size-4" />
              运行日志
            </button>
            <button
              onClick={() => navigate("devices")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                section === "devices" && !selectedMovie
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
              )}
            >
              <MonitorSmartphone className="size-4" />
              连接手机
              <span
                className={cn(
                  "ml-auto size-2 rounded-full",
                  snapshot.server.running ? "bg-emerald-400" : "bg-red-400",
                )}
              />
            </button>
            <button
              onClick={() => navigate("settings")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                section === "settings" && !selectedMovie
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
              )}
            >
              <Settings className="size-4" />
              设置
            </button>
          </div>
        </aside>

        <main
          ref={mainRef}
          className={cn(
            "min-w-0 flex-1",
            section === "tools" && !selectedMovie ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {selectedMovie ? (
            <MovieDetailPage
              movie={selectedMovie}
              onBack={backToLibrary}
              backLabel={
                actorPage
                  ? `返回${actorPage.name}的影片`
                  : tagPage
                    ? `返回“${tagPage.name}”标签`
                    : undefined
              }
              onActorSelect={openActor}
              onTagSelect={openTag}
              onChanged={refresh}
              notify={notify}
              ffmpegAvailable={
                snapshot.settings.ffmpeg.available &&
                snapshot.settings.ffmpeg.nvencAvailable
              }
              previewAvailable={snapshot.settings.ffmpeg.available}
            />
          ) : actorPage ? (
            <ActorMoviesPage
              actor={actorPage.name}
              movies={actorMovies}
              coverMode={gridCoverMode}
              onBack={closeActorPage}
              onOpen={openActorMovie}
              onPlay={playMovieFromCard}
              notify={notify}
              backLabel={
                actorPage.sourceMovieId ? "返回影片详情" : "返回演员库"
              }
            />
          ) : tagPage ? (
            <TagMoviesPage
              tag={tagPage.name}
              movies={tagMovies}
              coverMode={gridCoverMode}
              onBack={closeTagPage}
              onOpen={openTagMovie}
              onPlay={playMovieFromCard}
            />
          ) : section === "actors" ? (
            <ActorLibraryPage actors={actors} onOpen={openActorLibraryEntry} />
          ) : section === "tasks" ? (
            <TasksPage
              snapshot={snapshot}
              tasks={transcodeTasks}
              onChanged={async () =>
                setTranscodeTasks(await window.avault.getTranscodeTasks())
              }
              notify={notify}
            />
          ) : section === "ai" ? (
            <AiCenterPage
              snapshot={snapshot}
              refresh={refresh}
              notify={notify}
            />
          ) : section === "logs" ? (
            <LogsPage notify={notify} />
          ) : section === "tools" ? (
            <IndependentToolsPage snapshot={snapshot} notify={notify} />
          ) : section === "devices" ? (
            <DevicesPage
              snapshot={snapshot}
              refresh={refresh}
              notify={notify}
            />
          ) : section === "settings" ? (
            <SettingsPage
              snapshot={snapshot}
              refresh={refresh}
              notify={notify}
            />
          ) : (
            <>
              <header className="sticky top-0 z-20 border-b border-white/[0.055] bg-[#0e0f12]/85 px-8 py-5 backdrop-blur-xl">
                <div className="flex items-center gap-5">
                  <div className="min-w-0 flex-1">
                    <h1 className="truncate text-2xl font-bold tracking-tight">
                      {title}
                    </h1>
                    <p className="mt-1 text-xs text-zinc-600">
                      {activeLibrary
                        ? activeLibrary.path
                        : `共 ${movies.length} 部影片`}
                    </p>
                  </div>
                  <div className="relative w-80">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="搜索番号、标题或演员"
                      className="pl-9"
                    />
                  </div>
                  {section === "uncrawled" && (
                    <Button
                      variant="outline"
                      onClick={batchFetchAllMetadata}
                      disabled={metadataBatchAllRunning || Boolean(activeMetadataBatch)}
                    >
                      <Sparkles
                        className={cn(
                          "size-4",
                          (metadataBatchAllRunning || activeMetadataBatch) &&
                            "animate-pulse",
                        )}
                      />
                      {metadataBatchAllRunning || activeMetadataBatch
                        ? "正在批量爬取"
                        : "批量爬取资料"}
                    </Button>
                  )}
                  {activeLibrary && Boolean(0) && (
                    <>
                      <Select value={activeLibrary.sourcePartition ?? "auto"} onValueChange={(value) => void setLibraryPartition(activeLibrary, value)}>
                        <SelectTrigger className="w-[138px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">自动判断分区</SelectItem>
                          <SelectItem value="censored">有码</SelectItem>
                          <SelectItem value="fc2">FC2</SelectItem>
                          <SelectItem value="uncensored">无码</SelectItem>
                          <SelectItem value="leaked">流出</SelectItem>
                          <SelectItem value="unknown">待分类</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="secondary"
                        onClick={() => scan(activeLibrary)}
                        disabled={
                          scanProgress[activeLibrary.id]?.phase === "scanning"
                        }
                      >
                        <RefreshCw
                          className={cn(
                            "size-4",
                            scanProgress[activeLibrary.id]?.phase ===
                              "scanning" && "animate-spin",
                          )}
                        />
                        重新扫描
                      </Button>
                      {activeLibraryUnidentified > 0 && (
                        <Button
                          variant={libraryUnidentifiedOnly ? "secondary" : "outline"}
                          onClick={() => setLibraryUnidentifiedOnly((value) => !value)}
                        >
                          <CircleAlert className="size-4" />
                          {libraryUnidentifiedOnly ? "显示全部影片" : `未识别番号 ${activeLibraryUnidentified}`}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => previewOrganize(activeLibrary)}
                        disabled={
                          scanProgress[activeLibrary.id]?.phase ===
                            "scanning" || organizeProgress?.phase === "moving"
                        }
                      >
                        <FolderOpen className="size-4" />
                        整理媒体库
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => batchFetchMetadata(activeLibrary)}
                        disabled={["starting", "processing"].includes(
                          metadataBatchProgress[activeLibrary.id]?.phase ?? "",
                        )}
                      >
                        <Sparkles
                          className={cn(
                            "size-4",
                            ["starting", "processing"].includes(
                              metadataBatchProgress[activeLibrary.id]?.phase ??
                                "",
                            ) && "animate-pulse",
                          )}
                        />
                        {["starting", "processing"].includes(
                          metadataBatchProgress[activeLibrary.id]?.phase ?? "",
                        )
                          ? "正在批量爬取"
                          : "批量爬取资料"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => exportLocalJson(activeLibrary)}
                      >
                        <Archive className="size-4" />
                        写入本地 JSON
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(activeLibrary)}
                      >
                        <Trash2 className="size-4 text-zinc-500" />
                      </Button>
                    </>
                  )}
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <Select value={sourcePartitionFilter} onValueChange={(value) => setSourcePartitionFilter(value as typeof sourcePartitionFilter)}>
                    <SelectTrigger className="w-[154px] shrink-0 whitespace-nowrap"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部片源分区</SelectItem>
                      <SelectItem value="censored">有码</SelectItem>
                      <SelectItem value="fc2">FC2</SelectItem>
                      <SelectItem value="uncensored">无码</SelectItem>
                      <SelectItem value="leaked">流出</SelectItem>
                      <SelectItem value="unknown">待分类</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={watchFilter}
                    onValueChange={(value) =>
                      updateHomePreferences({
                        watchFilter: value as typeof watchFilter,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="unwatched">未观看</SelectItem>
                      <SelectItem value="watching">观看中</SelectItem>
                      <SelectItem value="watched">已看完</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={sort}
                    onValueChange={(value) =>
                      updateHomePreferences({ sort: value as SortMode })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="added-desc">最近添加</SelectItem>
                      <SelectItem value="added-asc">最早添加</SelectItem>
                      <SelectItem value="release-desc">
                        发行日期（最新）
                      </SelectItem>
                      <SelectItem value="release-asc">
                        发行日期（最早）
                      </SelectItem>
                      <SelectItem value="code-asc">番号排序</SelectItem>
                      <SelectItem value="title-asc">标题排序</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="ml-auto flex items-center gap-2">
                    {activeLibrary && <>
                      <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] pl-3">
                        <span className="whitespace-nowrap text-xs text-zinc-500">默认分区</span>
                        <Select value={activeLibrary.sourcePartition ?? "auto"} onValueChange={(value) => void setLibraryPartition(activeLibrary, value)}>
                          <SelectTrigger className="h-9 w-[112px] border-0 bg-transparent shadow-none"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="auto">自动判断</SelectItem><SelectItem value="censored">有码</SelectItem><SelectItem value="fc2">FC2</SelectItem><SelectItem value="uncensored">无码</SelectItem><SelectItem value="leaked">流出</SelectItem><SelectItem value="unknown">待分类</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <Button variant="secondary" onClick={() => scan(activeLibrary)} disabled={scanProgress[activeLibrary.id]?.phase === "scanning"}><RefreshCw className={cn("size-4", scanProgress[activeLibrary.id]?.phase === "scanning" && "animate-spin")} />重新扫描</Button>
                      {activeLibraryUnidentified > 0 && <Button variant={libraryUnidentifiedOnly ? "secondary" : "outline"} onClick={() => setLibraryUnidentifiedOnly((value) => !value)}><CircleAlert className="size-4" />{libraryUnidentifiedOnly ? "显示全部" : `未识别 ${activeLibraryUnidentified}`}</Button>}
                      <Button variant="outline" onClick={() => previewOrganize(activeLibrary)} disabled={scanProgress[activeLibrary.id]?.phase === "scanning" || organizeProgress?.phase === "moving"}><FolderOpen className="size-4" />整理媒体库</Button>
                      <Button variant="outline" onClick={() => batchFetchMetadata(activeLibrary)} disabled={["starting", "processing"].includes(metadataBatchProgress[activeLibrary.id]?.phase ?? "")}><Sparkles className={cn("size-4", ["starting", "processing"].includes(metadataBatchProgress[activeLibrary.id]?.phase ?? "") && "animate-pulse")} />{["starting", "processing"].includes(metadataBatchProgress[activeLibrary.id]?.phase ?? "") ? "正在爬取" : "批量爬取"}</Button>
                      <div ref={moreMenuRef} className="relative">
                        <Button variant="outline" size="sm" onClick={() => setMoreMenuOpen((open) => !open)} aria-expanded={moreMenuOpen}><MoreHorizontal className="size-4" />更多</Button>
                        {moreMenuOpen && <div className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#17181d] p-1.5 shadow-2xl">
                          <button type="button" onClick={() => { setMoreMenuOpen(false); void exportLocalJson(activeLibrary); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white"><Archive className="size-4" />写入本地 JSON</button>
                          <div className="my-1 h-px bg-white/[0.07]" />
                          <button type="button" onClick={() => { setMoreMenuOpen(false); void remove(activeLibrary); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10"><Trash2 className="size-4" />移除媒体文件夹</button>
                        </div>}
                      </div>
                    </>}
                    <div className="flex rounded-lg border border-white/8 bg-white/[0.03] p-1">
                    <button
                      title="横向封面"
                      onClick={() => updateHomePreferences({ view: "grid", gridCoverMode: "landscape" })}
                      className={cn(
                        "rounded-md p-1.5",
                        view === "grid" && gridCoverMode === "landscape"
                          ? "bg-white/10 text-white"
                          : "text-zinc-600",
                      )}
                    >
                      <RectangleHorizontal className="size-4" />
                    </button>
                    <button
                      title="竖向封面"
                      onClick={() => updateHomePreferences({ view: "grid", gridCoverMode: "portrait" })}
                      className={cn(
                        "rounded-md p-1.5",
                        view === "grid" && gridCoverMode === "portrait"
                          ? "bg-white/10 text-white"
                          : "text-zinc-600",
                      )}
                    >
                      <RectangleVertical className="size-4" />
                    </button>
                    <button
                      title="列表"
                      onClick={() => updateHomePreferences({ view: "list" })}
                      className={cn(
                        "rounded-md p-1.5",
                        view === "list"
                          ? "bg-white/10 text-white"
                          : "text-zinc-600",
                      )}
                    >
                      <List className="size-4" />
                    </button>
                    </div>
                  </div>
                </div>
              </header>
              {activeLibrary &&
                scanProgress[activeLibrary.id] &&
                ["starting", "scanning"].includes(
                  scanProgress[activeLibrary.id].phase,
                ) && (
                  <div className="mx-8 mt-5 flex items-center gap-3 rounded-xl border border-violet-500/15 bg-violet-500/[0.06] px-4 py-3 text-sm text-violet-200">
                    <LoaderCircle className="size-4 animate-spin" />
                    <span>
                      正在扫描 {scanProgress[activeLibrary.id].discovered}{" "}
                      个文件
                    </span>
                    <span className="truncate text-xs text-violet-400/60">
                      {scanProgress[activeLibrary.id].currentPath}
                    </span>
                  </div>
                )}
              {(activeLibrary
                ? metadataBatchProgress[activeLibrary.id]
                : section === "uncrawled"
                  ? activeMetadataBatch
                  : null) &&
                (() => {
                  const progress = activeLibrary
                    ? metadataBatchProgress[activeLibrary.id]
                    : activeMetadataBatch;
                  if (
                    !progress ||
                    !["starting", "processing"].includes(progress.phase)
                  )
                    return null;
                  return (
                  <div className="mx-8 mt-5 flex items-center gap-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-4 py-3 text-sm text-amber-100">
                    <LoaderCircle className="size-4 animate-spin" />
                    <span>
                      正在安全爬取{" "}
                      {progress.completed}/{progress.total}
                    </span>
                    <span className="text-xs text-amber-300/70">
                      {progress.currentCode} · {progress.message ?? "每部间隔约 5–7 秒"}
                    </span>
                  </div>
                  );
                })()}
              {activeLibrary &&
                scanProgress[activeLibrary.id]?.phase === "complete" && (
                  <div className="mx-8 mt-5 flex items-center gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.05] px-4 py-3 text-xs text-emerald-200">
                    <RefreshCw className="size-4" />
                    扫描完成：发现 {
                      scanProgress[activeLibrary.id].discovered
                    }{" "}
                    个文件，识别 {scanProgress[activeLibrary.id].recognized}{" "}
                    个，未识别 {scanProgress[activeLibrary.id].unrecognized}{" "}
                    个，错误 {scanProgress[activeLibrary.id].errors} 个。
                    {activeLibraryUnidentified > 0 && <button type="button" onClick={() => setLibraryUnidentifiedOnly(true)} className="ml-1 font-medium text-emerald-100 underline underline-offset-2 hover:text-white">查看未识别番号</button>}
                  </div>
                )}
              <div className="p-8">
                {movies.length === 0 ? (
                  <div className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/8 bg-white/[0.015] text-center">
                    <div className="rounded-2xl bg-white/5 p-5">
                      <HardDrive className="size-10 text-zinc-600" />
                    </div>
                    <h2 className="mt-5 font-semibold text-zinc-300">
                      这里还没有影片
                    </h2>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-600">
                      添加本地媒体文件夹后，AVault
                      只会扫描文件并识别番号，不会自动从网络获取资料。
                    </p>
                    <Button onClick={addLibrary} className="mt-6">
                      <FolderOpen className="size-4" />
                      选择媒体文件夹
                    </Button>
                  </div>
                ) : (
                  <div
                    className={cn(
                      view === "grid"
                        ? gridCoverMode === "portrait"
                          ? "grid gap-x-4 gap-y-4"
                          : "grid gap-x-4 gap-y-4"
                        : "space-y-4",
                      view === "grid" &&
                        (gridCoverMode === "portrait"
                          ? "grid-cols-[repeat(auto-fill,minmax(205px,1fr))]"
                          : "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]"),
                    )}
                  >
                    {movies.map((movie) => (
                      <MovieCard
                        key={movie.id}
                        movie={movie}
                        mode={view}
                        coverMode={gridCoverMode}
                        onOpen={() => openMovie(movie.id)}
                        onPlay={() => playMovieFromCard(movie.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>

        <Dialog
          open={Boolean(organizePreview)}
          onOpenChange={(open) => {
            if (!open) closeOrganizeDialog();
          }}
        >
          <DialogContent className="w-[min(900px,94vw)] p-6">
            <DialogTitle>整理媒体库</DialogTitle>
            <DialogDescription className="mt-2">
              仅移动当前媒体文件夹内已扫描到的视频文件。不会覆盖或复制文件；整理完成后，会直接删除已迁走视频的旧影片目录及其中残留的 NFO、封面、字幕等旁路文件。
            </DialogDescription>
            {organizePreview && !organizeProgress && (
              <>
                <div className="mt-5 grid grid-cols-5 gap-3">
                  <button type="button" onClick={() => setOrganizePreviewFilter("all")} className={cn("rounded-xl border p-3 text-left transition-colors", organizePreviewFilter === "all" ? "border-white/20 bg-white/[0.07]" : "border-white/8 bg-white/[0.025] hover:bg-white/[0.05]")}>
                    <div className="text-xs text-zinc-600">将创建目录</div>
                    <div className="mt-1 text-lg font-semibold">
                      {organizePreview.directories.length}
                    </div>
                  </button>
                  <button type="button" onClick={() => setOrganizePreviewFilter("move")} className={cn("rounded-xl border p-3 text-left transition-colors", organizePreviewFilter === "move" ? "border-emerald-400/45 bg-emerald-500/[0.12]" : "border-emerald-500/15 bg-emerald-500/[0.05] hover:bg-emerald-500/[0.09]")}>
                    <div className="text-xs text-emerald-300/70">
                      可移动文件
                    </div>
                    <div className="mt-1 text-lg font-semibold text-emerald-200">
                      {organizePreview.movable}
                    </div>
                  </button>
                  <button type="button" onClick={() => setOrganizePreviewFilter("skip")} className={cn("rounded-xl border p-3 text-left transition-colors", organizePreviewFilter === "skip" ? "border-amber-400/45 bg-amber-500/[0.12]" : "border-amber-500/15 bg-amber-500/[0.05] hover:bg-amber-500/[0.09]")}>
                    <div className="text-xs text-amber-300/70">将跳过</div>
                    <div className="mt-1 text-lg font-semibold text-amber-200">
                      {organizePreview.skipped}
                    </div>
                  </button>
                  <button type="button" onClick={() => setOrganizePreviewFilter("cleanup")} className={cn("rounded-xl border p-3 text-left transition-colors", organizePreviewFilter === "cleanup" ? "border-rose-400/45 bg-rose-500/[0.12]" : "border-rose-500/15 bg-rose-500/[0.05] hover:bg-rose-500/[0.09]")}>
                    <div className="text-xs text-rose-300/70">预计清理旧目录</div>
                    <div className="mt-1 text-lg font-semibold text-rose-200">{organizePreview.cleanupDirectories.length}</div>
                  </button>
                  <button type="button" onClick={() => setOrganizePreviewFilter("all")} className="rounded-xl border border-violet-500/15 bg-violet-500/[0.05] p-3 text-left transition-colors hover:bg-violet-500/[0.09]">
                    <div className="text-xs text-violet-300/70">未识别番号</div>
                    <div className="mt-1 text-lg font-semibold text-violet-200">
                      {organizePreview.unrecognized}
                    </div>
                  </button>
                </div>
                <div className="mt-5 h-[42vh] overflow-y-auto rounded-xl border border-white/8 bg-black/20">
                  {organizePreviewFilter === "cleanup" ? organizePreview.cleanupDirectories.map((directory) => (
                    <div key={directory} className="border-b border-white/[0.055] px-4 py-3 last:border-0">
                      <div className="flex items-center gap-3 text-sm"><span className="shrink-0 rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-200">清理目录</span><span className="min-w-0 truncate text-zinc-300">{directory}</span></div>
                      <div className="mt-1 pl-16 text-xs text-zinc-600">仅在目录内没有跳过文件、且全部视频移动成功后删除</div>
                    </div>
                  )) : organizePreview.items.filter((item) => organizePreviewFilter === "all" || item.action === organizePreviewFilter).map((item) => (
                    <div
                      key={item.fileId}
                      className="border-b border-white/[0.055] px-4 py-3 last:border-0"
                    >
                      <div className="flex items-center gap-3 text-sm">
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[11px]",
                            item.action === "move"
                              ? "bg-emerald-500/10 text-emerald-300"
                              : "bg-amber-500/10 text-amber-200",
                          )}
                        >
                          {item.action === "move" ? "移动" : "跳过"}
                        </span>
                        <span className="min-w-0 truncate text-zinc-300">
                          {item.sourceRelativePath}
                        </span>
                      </div>
                      {item.targetRelativePath && (
                        <div className="mt-1 truncate pl-12 text-xs text-zinc-600">
                          → {item.targetRelativePath}
                        </div>
                      )}
                      {item.reason && (
                        <div className="mt-1 pl-12 text-xs text-amber-300/75">
                          {item.reason}
                        </div>
                      )}
                    </div>
                  ))}
                  {((organizePreviewFilter === "cleanup" && organizePreview.cleanupDirectories.length === 0) || (organizePreviewFilter !== "cleanup" && organizePreview.items.filter((item) => organizePreviewFilter === "all" || item.action === organizePreviewFilter).length === 0)) && <div className="flex h-full items-center justify-center px-4 text-center text-sm text-zinc-600">此分类没有项目</div>}
                </div>
                <div className="mt-5 flex items-center justify-between gap-4">
                  <p className="text-xs leading-5 text-zinc-600">
                    归档规则：演员/番号/文件。多演员使用第一位；无演员归入“未知演员”。
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={closeOrganizeDialog}>
                      取消
                    </Button>
                    <Button
                      onClick={runOrganize}
                      disabled={organizePreview.movable === 0}
                    >
                      <FolderOpen className="size-4" />
                      确认整理并清理旧目录
                    </Button>
                  </div>
                </div>
              </>
            )}
            {organizePreview && organizeProgress && (
              <div className="mt-6">
                <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.05] p-5">
                  <div className="flex items-center gap-3">
                    <LoaderCircle
                      className={cn(
                        "size-5 text-violet-300",
                        organizeProgress.phase === "moving" && "animate-spin",
                      )}
                    />
                    <div>
                      <div className="font-medium">
                        {organizeProgress.phase === "moving"
                          ? "正在整理文件…"
                          : organizeProgress.phase === "complete"
                            ? "整理完成"
                            : "已停止后续整理"}
                      </div>
                      <div className="mt-1 text-sm text-zinc-500">
                        已移动 {organizeProgress.moved} 个，跳过{" "}
                        {organizeProgress.skipped} 个，共处理{" "}
                        {organizeProgress.completed}/{organizeProgress.total}{" "}
                        个。
                      </div>
                    </div>
                  </div>
                  {organizeProgress.currentPath && (
                    <div className="mt-4 truncate rounded-lg bg-black/25 px-3 py-2 font-mono text-xs text-zinc-500">
                      {organizeProgress.currentPath}
                    </div>
                  )}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  {organizeProgress.phase === "moving" ? (
                    <Button
                      variant="secondary"
                      onClick={() => void window.avault.cancelOrganizeLibrary()}
                    >
                      停止后续移动
                    </Button>
                  ) : (
                    <Button onClick={closeOrganizeDialog}>关闭</Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {toast && (
          <div
            className={cn(
              "fixed bottom-6 right-6 z-[100] flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur",
              toast.error
                ? "border-red-500/20 bg-red-950/90 text-red-200"
                : "border-emerald-500/20 bg-emerald-950/90 text-emerald-100",
            )}
          >
            {toast.error ? (
              <CircleAlert className="size-4" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}
