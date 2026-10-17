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
  BackupProgress,
  BackupRestoreReport,
  BackupState,
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
import { IndependentToolsPage, type ToolboxSession } from './ToolboxPage';
import { TaskDrawer, UnifiedTaskList, type UnifiedTask } from "./TaskCenter";

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
type ActorRoute = { name: string; sourceMovieId: string | null };
type TagRoute = { name: string; sourceMovieId: string };
type NavigationEntry = {
  section: Section;
  selectedId: string | null;
  actorPage: ActorRoute | null;
  tagPage: TagRoute | null;
  libraryUnidentifiedOnly: boolean;
  scrollTop: number;
};
type LibraryWorkspaceState = {
  scrollTop: number;
  search: string;
  sort: SortMode;
  watchFilter: "all" | WatchStatus;
  sourcePartitionFilter: "all" | SourcePartition;
  libraryUnidentifiedOnly: boolean;
  view: "grid" | "list";
  gridCoverMode: GridCoverMode;
  actorSearch: string;
};
type SettingsWorkspaceState = { fc2CookieDraft: string | null; fc2CookieExpanded: boolean };

const emptyToolboxSession = (): ToolboxSession => ({
  tab: "merge", mergeFiles: [], transcodeFiles: [], cutFile: null, probeFiles: [], probePath: null,
  outputName: "合并影片", cutStart: "00:00:00", cutEnd: "00:00:00", cutMode: "copy", codec: "hevc", height: "keep", frameRate: "keep", cq: "23", maxBitrate: "",
});

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

function BackNavigationHeader({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle: string }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-white/[0.055] bg-[#0e0f12]/85 px-8 py-4 backdrop-blur-xl">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="size-4" />
        返回上一页
      </Button>
      <div className="h-5 w-px bg-white/10" />
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold text-zinc-200">{title}</h1>
        <p className="text-xs text-zinc-600">{subtitle}</p>
      </div>
    </header>
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
        event.preventDefault();
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
            onClick={() => window.avault.cancelTranscode(transcode.fileId, transcode.kind)}
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
    <div className="relative isolate min-h-full w-full overflow-x-clip">
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

  useEffect(() => {
    if (!avatarPreviewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAvatarPreviewOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [avatarPreviewOpen]);

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
  search,
  onSearchChange,
}: {
  actors: Array<{ name: string; movieCount: number }>;
  onOpen: (actor: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
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
              onChange={(event) => onSearchChange(event.target.value)}
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
              。获取资料时会优先查询日文 Wikipedia 与 Wikidata，再搜索公开网页补充社交链接；无法确认的字段保持为空。
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

function SettingsPage({
  snapshot,
  refresh,
  notify,
  workspace,
  setWorkspace,
}: {
  snapshot: AppSnapshot;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  workspace: SettingsWorkspaceState;
  setWorkspace: React.Dispatch<React.SetStateAction<SettingsWorkspaceState>>;
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
  const [savingFc2Cookie, setSavingFc2Cookie] = useState(false);
  const [backupState, setBackupState] = useState<BackupState | null>(null);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  const [restoreReport, setRestoreReport] = useState<BackupRestoreReport | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const refreshBackups = useCallback(async () => setBackupState(await window.avault.getBackupState()), []);
  useEffect(() => {
    void refreshBackups().catch((error) => notify(errorMessage(error), true));
    const unsubscribe = window.avault.onBackupProgress((progress) => {
      setBackupProgress(progress);
      if (progress.phase === "complete" || progress.phase === "cancelled" || progress.phase === "error") {
        setBackupBusy(false);
        void refreshBackups();
      }
    });
    void window.avault.getLastRestoreReport().then((report) => {
      if (!report) return;
      setRestoreReport(report);
      notify(`数据已恢复：旁路资料 ${report.restoredCompanionFiles} 个${report.skippedCompanionFiles ? `，跳过 ${report.skippedCompanionFiles} 个` : ""}`);
    });
    return unsubscribe;
  }, [notify, refreshBackups]);
  async function createBackup() {
    setBackupBusy(true);
    try {
      await window.avault.createBackup();
      await refreshBackups();
      notify("数据备份已完成");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBackupBusy(false);
    }
  }
  async function chooseBackupDirectory() {
    try {
      const path = await window.avault.chooseBackupDirectory();
      if (path) { await refreshBackups(); notify("备份目录已保存"); }
    } catch (error) { notify(errorMessage(error), true); }
  }
  async function restoreBackup(directory: string) {
    const record = backupState?.records.find((item) => item.directory === directory);
    if (!record || record.status !== "completed") return;
    const confirmed = confirm(`恢复“${record.id}”？\n\n恢复前会自动创建当前数据的安全快照。此备份包含已配对设备、Cookie 和 API Key；恢复完成后 AVault 将自动重启。`);
    if (!confirmed) return;
    try { await window.avault.restoreBackup(directory); } catch (error) { notify(errorMessage(error), true); }
  }
  const fc2Cookie = workspace.fc2CookieDraft ?? snapshot.settings.fc2Cookie;
  const fc2CookieExpanded = workspace.fc2CookieExpanded;
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
    <div className="mx-auto max-w-6xl px-8 py-7">
      <h1 className="text-2xl font-bold">设置</h1>
      <p className="mt-2 text-sm text-zinc-500">管理播放器和元数据服务。</p>
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
        <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-5">
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
        <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-5">
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
        <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-5 lg:col-span-2">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-sky-500/10 p-3"><Archive className="size-5 text-sky-300" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">数据备份与恢复</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">备份数据库、演员头像和应用设置；不会复制影片目录内的封面、预览图或本地 JSON，也不复制视频和转码文件。备份包含配对、Cookie 与 API Key，请妥善保管。</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void window.avault.revealBackupDirectory()} disabled={backupBusy}><FolderOpen className="size-4" />打开目录</Button>
                  <Button size="sm" variant="secondary" onClick={chooseBackupDirectory} disabled={backupBusy}>选择目录</Button>
                  <Button size="sm" onClick={createBackup} disabled={backupBusy}>{backupBusy && <LoaderCircle className="size-4 animate-spin" />}{backupBusy ? "正在备份" : "立即备份"}</Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-xs text-zinc-500">
                <HardDrive className="size-3.5 text-zinc-400" /><span className="max-w-full truncate">{backupState?.directory ?? "正在读取备份目录…"}</span><span className="text-zinc-700">·</span><span>保留最近 5 份完整备份</span>
              </div>
              {backupProgress && backupBusy && <div className="mt-3 rounded-lg border border-sky-400/15 bg-sky-400/[0.05] px-3 py-2 text-xs text-sky-100"><div className="flex items-center justify-between gap-3"><span>{backupProgress.message}</span><span className="text-sky-300">{backupProgress.copiedFiles} 个文件 · {formatBytes(backupProgress.copiedBytes)}</span></div><div className="mt-2 h-1 overflow-hidden rounded bg-white/10"><div className="h-full w-2/3 animate-pulse rounded bg-sky-400" /></div>{backupProgress.cancellable && <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs" onClick={() => void window.avault.cancelBackup()}>取消备份</Button>}</div>}
              <div className="mt-4 space-y-2">
                {restoreReport && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-3 text-xs text-emerald-100"><div className="flex items-start justify-between gap-3"><div><b>上次恢复完成</b><p className="mt-1 leading-5 text-emerald-200/75">数据库、演员头像和应用设置已恢复。影片目录内容未被修改。恢复前安全快照：{restoreReport.safetySnapshotDirectory ?? "未记录"}</p></div><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setRestoreReport(null); void window.avault.clearLastRestoreReport(); }}>关闭</Button></div></div>}
                {backupState?.records.length ? backupState.records.map((record) => <div key={record.directory} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2.5 text-xs"><Archive className={cn("size-4", record.status === "completed" ? "text-sky-300" : "text-amber-300")} /><div className="min-w-[180px] flex-1"><div className="font-medium text-zinc-200">{record.id}{record.isSafetySnapshot && <span className="ml-2 text-[10px] text-amber-300">恢复前安全快照</span>}</div><div className="mt-0.5 text-zinc-600">{record.status === "completed" ? `${formatDate(record.createdAt)} · ${formatBytes(record.size)} · ${record.libraryCount} 个媒体目录` : record.status === "incomplete" ? "未完成备份，不能恢复" : "备份无效或已损坏"}</div></div>{record.status === "completed" && <Button size="sm" variant="outline" onClick={() => void restoreBackup(record.directory)} disabled={backupBusy}>恢复此备份</Button>}</div>) : <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-zinc-600">尚无备份。建议在大量整理、批量爬取或升级前创建一份。</div>}
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-white/8 bg-white/[0.025] p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
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
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setWorkspace((current) => ({ ...current, fc2CookieExpanded: !current.fc2CookieExpanded }))}
                  >
                    {fc2CookieExpanded ? "收起" : "编辑 Cookie"}
                  </Button>
                </div>
                {fc2CookieExpanded && <>
                  <Textarea
                    value={fc2Cookie}
                    onChange={(event) => setWorkspace((current) => ({ ...current, fc2CookieDraft: event.target.value }))}
                    placeholder="name=value; name2=value2"
                    className="mt-3 min-h-28 font-mono text-xs"
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
                          setWorkspace((current) => ({ ...current, fc2CookieDraft: "" }));
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
                </>}
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
  const [actorPage, setActorPage] = useState<ActorRoute | null>(null);
  const [tagPage, setTagPage] = useState<TagRoute | null>(null);
  const navigationHistoryRef = useRef<NavigationEntry[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);
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
  const [toolTasks, setToolTasks] = useState<ToolTask[]>([]);
  const [toolboxSession, setToolboxSession] = useState<ToolboxSession>(emptyToolboxSession);
  const [settingsWorkspace, setSettingsWorkspace] = useState<SettingsWorkspaceState>({ fc2CookieDraft: null, fc2CookieExpanded: false });
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [actorLibrarySearch, setActorLibrarySearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshCountRef = useRef(0);
  const workspaceScrollRef = useRef(new Map<Section, number>());
  const workspaceStateRef = useRef(new Map<Section, LibraryWorkspaceState>());
  const preferencesInitializedRef = useRef(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const libraryScrollRef = useRef(0);
  const actorLibraryScrollRef = useRef(0);
  const actorScrollRef = useRef(0);
  const tagScrollRef = useRef(0);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    refreshCountRef.current += 1;
    setRefreshing(true);
    try {
      setSnapshot(await window.avault.getSnapshot());
    } finally {
      refreshCountRef.current = Math.max(0, refreshCountRef.current - 1);
      if (refreshCountRef.current === 0) setRefreshing(false);
    }
  }, []);
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    if (preferencesInitializedRef.current) return;
    preferencesInitializedRef.current = true;
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
    void window.avault.getToolTasks().then(setToolTasks).catch(() => undefined);
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
    const unsubscribeTool = window.avault.onToolTaskProgress((task) => {
      setToolTasks((current) => {
        const index = current.findIndex((item) => item.id === task.id);
        return index < 0 ? [...current, task] : current.map((item) => item.id === task.id ? task : item);
      });
    });
    return () => {
      unsubscribeScan();
      unsubscribeMetadataBatch();
      unsubscribeOrganize();
      unsubscribeTranscode();
      unsubscribeTool();
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
  const unifiedTasks = useMemo<UnifiedTask[]>(() => {
    const files = new Map((snapshot?.movies ?? []).flatMap((movie) => movie.files).map((file) => [file.id, file]));
    const media = transcodeTasks.map((task) => {
      const file = files.get(task.fileId);
      return {
        id: `media:${task.fileId}:${task.kind}`, source: "媒体库" as const,
        name: file?.name ?? "源文件已移除",
        detail: task.kind === "hevc" ? "高清 HEVC 原分辨率" : "720p HEVC",
        state: task.state, percent: task.percent, speed: task.speed, etaSeconds: task.etaSeconds,
        outputPath: task.outputPath, message: task.message, createdAt: task.createdAt, queueOrder: task.queueOrder,
        cancel: async () => { await window.avault.cancelTranscode(task.fileId, task.kind); },
        remove: async () => {
          await window.avault.removeTranscodeTask(task.fileId, task.kind);
          setTranscodeTasks((current) => current.filter((item) => item.fileId !== task.fileId || item.kind !== task.kind));
        },
      };
    });
    const tools = toolTasks.map((task) => ({
      id: `tool:${task.id}`, source: "工具箱" as const, name: task.outputName,
      detail: task.type === "merge-copy" ? "无损合并" : task.type === "merge-transcode" ? "转码合并" : task.type === "cut-copy" ? "快速无损剪切" : task.type === "cut-transcode" ? "精确剪切" : "独立转码",
      state: task.state, percent: task.percent, speed: task.speed, etaSeconds: task.etaSeconds,
      outputPath: task.outputPath, message: task.message, createdAt: task.createdAt, queueOrder: task.queueOrder,
      cancel: () => window.avault.cancelToolTask(task.id), remove: async () => {
        await window.avault.removeToolTask(task.id);
        setToolTasks((current) => current.filter((item) => item.id !== task.id));
      },
    }));
    return [...media, ...tools];
  }, [snapshot?.movies, toolTasks, transcodeTasks]);
  const activeTaskCount = unifiedTasks.filter((task) => task.state === "queued" || task.state === "running").length;
  const title =
    section === "all"
      ? "全部影片"
      : section === "uncrawled"
        ? "未获取资料"
        : section === "unidentified"
          ? "未识别影片"
          : (activeLibrary?.name ?? "AVault");
  const navigationHeader = (() => {
    switch (section) {
      case "tools": return { title: "工具箱", subtitle: "独立本地媒体处理" };
      case "tasks": return { title: "转码任务", subtitle: "任务队列与进度" };
      case "ai": return { title: "AI 中心", subtitle: "演员资料与用量管理" };
      case "logs": return { title: "运行日志", subtitle: "资料与 FFmpeg 运行记录" };
      case "devices": return { title: "连接手机", subtitle: "局域网配对与设备管理" };
      case "settings": return { title: "设置", subtitle: "播放器与元数据服务" };
      case "actors": return { title: "演员库", subtitle: "浏览本地演员资料" };
      case "uncrawled": return { title: "未获取资料", subtitle: "等待补充影片资料" };
      case "unidentified": return { title: "未识别影片", subtitle: "需要确认番号的本地文件" };
      case "all": return { title: "全部影片", subtitle: "本地媒体库" };
      default: return { title: activeLibrary?.name ?? "媒体文件夹", subtitle: activeLibrary?.path ?? "本地媒体库" };
    }
  })();
  const showToolBack = section === "tools" && canGoBack;
  const showUtilityBack =
    canGoBack &&
    (["settings", "tasks", "ai", "logs", "devices"] as Section[]).includes(section);

  function scrollMainTo(top: number) {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => mainRef.current?.scrollTo({ top })),
    );
  }

  function saveWorkspaceState() {
    if (selectedId || actorPage || tagPage) return;
    workspaceScrollRef.current.set(section, mainRef.current?.scrollTop ?? 0);
    workspaceStateRef.current.set(section, {
      scrollTop: mainRef.current?.scrollTop ?? 0,
      search, sort, watchFilter, sourcePartitionFilter, libraryUnidentifiedOnly, view, gridCoverMode, actorSearch: actorLibrarySearch,
    });
  }

  function restoreWorkspaceState(next: Section) {
    const saved = workspaceStateRef.current.get(next);
    const fallback = snapshot!.settings.homePreferences;
    const state = saved ?? {
      scrollTop: workspaceScrollRef.current.get(next) ?? 0,
      search: "", sort: fallback.sort, watchFilter: fallback.watchFilter,
      sourcePartitionFilter: "all" as const, libraryUnidentifiedOnly: false,
      view: fallback.view, gridCoverMode: fallback.gridCoverMode, actorSearch: "",
    };
    setSearch(state.search);
    setSort(state.sort);
    setWatchFilter(state.watchFilter);
    setSourcePartitionFilter(state.sourcePartitionFilter);
    setLibraryUnidentifiedOnly(state.libraryUnidentifiedOnly);
    setView(state.view);
    setGridCoverMode(state.gridCoverMode);
    setActorLibrarySearch(state.actorSearch);
    scrollMainTo(state.scrollTop);
  }

  function navigate(next: Section) {
    const isAlreadyHere = section === next && !selectedId && !actorPage && !tagPage;
    if (isAlreadyHere) return;
    saveWorkspaceState();
    const utilitySections: Section[] = ["tools", "tasks", "ai", "logs", "devices", "settings"];
    if (utilitySections.includes(next)) {
      navigationHistoryRef.current = [
        ...navigationHistoryRef.current.slice(-29),
        { section, selectedId, actorPage, tagPage, libraryUnidentifiedOnly, scrollTop: mainRef.current?.scrollTop ?? 0 },
      ];
      setCanGoBack(true);
    } else {
      navigationHistoryRef.current = [];
      setCanGoBack(false);
    }
    setSelectedId(null);
    setActorPage(null);
    setTagPage(null);
    setSection(next);
    restoreWorkspaceState(next);
  }

  function goBack() {
    const previous = navigationHistoryRef.current.pop();
    setCanGoBack(navigationHistoryRef.current.length > 0);
    if (!previous) return;
    setSection(previous.section);
    setSelectedId(previous.selectedId);
    setActorPage(previous.actorPage);
    setTagPage(previous.tagPage);
    setLibraryUnidentifiedOnly(previous.libraryUnidentifiedOnly);
    if (!previous.selectedId && !previous.actorPage && !previous.tagPage)
      restoreWorkspaceState(previous.section);
    else scrollMainTo(previous.scrollTop);
  }

  function openMovie(id: string) {
    saveWorkspaceState();
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
    else {
      setSection("actors");
      restoreWorkspaceState("actors");
    }
    if (sourceMovieId) scrollMainTo(0);
  }

  function openActorLibraryEntry(actor: string) {
    saveWorkspaceState();
    actorLibraryScrollRef.current = mainRef.current?.scrollTop ?? 0;
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

  useEffect(() => {
    const handleEscapeBack = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat)
        return;

      // 覆盖层优先处理 Escape，避免关闭图片预览或编辑弹窗时又意外离开详情页。
      if (moreMenuOpen) {
        event.preventDefault();
        setMoreMenuOpen(false);
        return;
      }
      if (taskDrawerOpen) {
        event.preventDefault();
        setTaskDrawerOpen(false);
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;

      if (selectedId) {
        event.preventDefault();
        backToLibrary();
      } else if (actorPage) {
        event.preventDefault();
        closeActorPage();
      } else if (tagPage) {
        event.preventDefault();
        closeTagPage();
      } else if (canGoBack) {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", handleEscapeBack);
    return () => window.removeEventListener("keydown", handleEscapeBack);
  }, [actorPage, canGoBack, moreMenuOpen, selectedId, tagPage, taskDrawerOpen]);

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
              onClick={() => setTaskDrawerOpen(true)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm",
                taskDrawerOpen || (section === "tasks" && !selectedMovie)
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
              )}
            >
              <Archive className="size-4" />
              任务
              {activeTaskCount > 0 && (
                <Badge className="ml-auto border-0 bg-violet-500/15 px-1.5 py-0 text-[10px] text-violet-300">
                  {activeTaskCount}
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
          {showUtilityBack && (
            <BackNavigationHeader onBack={goBack} {...navigationHeader} />
          )}
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
            <ActorLibraryPage actors={actors} onOpen={openActorLibraryEntry} search={actorLibrarySearch} onSearchChange={setActorLibrarySearch} />
          ) : section === "tasks" ? (
            <div className="mx-auto max-w-5xl p-8">
              <h1 className="text-2xl font-bold">全部任务</h1>
              <p className="mt-2 text-sm text-zinc-500">媒体库与工具箱任务按同一 FFmpeg 队列执行。</p>
              <div className="mt-6"><UnifiedTaskList tasks={unifiedTasks} notify={notify} /></div>
            </div>
          ) : section === "ai" ? (
            <AiCenterPage
              snapshot={snapshot}
              refresh={refresh}
              notify={notify}
            />
          ) : section === "logs" ? (
            <LogsPage notify={notify} />
          ) : section === "tools" ? (
            showToolBack ? (
              <div className="flex h-full min-h-0 flex-col">
                <BackNavigationHeader onBack={goBack} {...navigationHeader} />
                <div className="min-h-0 flex-1">
                  <IndependentToolsPage snapshot={snapshot} notify={notify} session={toolboxSession} setSession={setToolboxSession} />
                </div>
              </div>
            ) : (
              <IndependentToolsPage snapshot={snapshot} notify={notify} session={toolboxSession} setSession={setToolboxSession} />
            )
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
              workspace={settingsWorkspace}
              setWorkspace={setSettingsWorkspace}
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg px-3.5 text-sm"
                      onClick={() => void refresh()}
                      disabled={refreshing}
                      title="重新读取媒体库资料，不扫描文件"
                      aria-busy={refreshing}
                    >
                      <RefreshCw
                        className={cn(
                          "size-4 transition-transform",
                          refreshing && "animate-spin",
                        )}
                      />
                      {refreshing ? "刷新中" : "刷新"}
                    </Button>
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

        <TaskDrawer
          open={taskDrawerOpen}
          onClose={() => setTaskDrawerOpen(false)}
          onOpenTasks={() => {
            setTaskDrawerOpen(false);
            navigate("tasks");
          }}
          tasks={unifiedTasks}
          notify={notify}
        />

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
