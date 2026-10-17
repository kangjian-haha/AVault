import SwiftUI

let statuses = [("", "全部状态"), ("unwatched", "未观看"), ("watching", "观看中"), ("watched", "已看完")]
let sources = [("", "全部片源"), ("censored", "有码"), ("fc2", "FC2"), ("uncensored", "无码"), ("leaked", "流出"), ("unknown", "待分类")]
struct RootView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        Group {
            if store.pairing == nil { PairingView() }
            else if store.connected { MainTabView() }
            else { ContentUnavailableView { Label("连接电脑", systemImage: "desktopcomputer") } description: { Text(store.error ?? "正在连接上次配对的 AVault 电脑…") } actions: { if store.connecting { ProgressView() }; Button("重试") { Task { await store.connect() } }; Button("重新扫码") { store.clearPairing() } } }
        }.preferredColorScheme(.dark).tint(.purple).task { await store.connect() }
    }
}
struct PairingView: View {
    @EnvironmentObject var store: AppStore
    @State private var scanner = false
    @State private var payload = ""
    var body: some View {
        NavigationStack { Form {
            Section { Label("AVault", systemImage: "play.rectangle.fill").font(.largeTitle.bold()); Text("在同一局域网中连接你的电脑，浏览媒体库并播放影片。").foregroundStyle(.secondary) }
            Section("连接步骤") { Text("1. 打开电脑端 AVault 的“连接手机”页面。\n2. 生成配对二维码。\n3. 点击下方按钮扫码。"); Button("扫码连接", systemImage: "qrcode.viewfinder") { scanner = true }.disabled(store.connecting) }
            Section("也可粘贴配对二维码的 JSON 内容") { TextEditor(text: $payload).frame(height: 100); Button("配对") { Task { await store.pair(payload: payload) } }.disabled(payload.isEmpty || store.connecting) }
            if store.connecting { ProgressView("正在配对…") }
            if let error = store.error { Text(error).foregroundStyle(.red) }
        }.navigationTitle("连接 AVault").sheet(isPresented: $scanner) { ScannerView { value in scanner = false; Task { await store.pair(payload: value) } } } }
    }
}
struct MainTabView: View {
    var body: some View { TabView {
        NavigationStack { LibraryView() }.tabItem { Label("媒体库", systemImage: "square.grid.2x2") }
        NavigationStack { PeopleView() }.tabItem { Label("演员库", systemImage: "person.2") }
        NavigationStack { SettingsView() }.tabItem { Label("设置", systemImage: "gearshape") }
    } }
}
struct LibraryView: View {
    var title = "媒体库"; var actor: String?; var tag: String?; var searchMode = false
    @EnvironmentObject var store: AppStore
    @AppStorage("movieSort") private var sort = "added-desc"
    @AppStorage("movieGrid") private var grid = true
    @AppStorage("searchHistory") private var historyData = "[]"
    @State private var query = ""; @State private var submitted = ""
    @State private var status = ""; @State private var source = ""
    @State private var movies: [Movie] = []; @State private var page = 0; @State private var total = 0
    @State private var loading = false; @State private var error: String?; @State private var revision = 0
    @State private var requestID = UUID()
    var history: [String] { (try? JSONDecoder().decode([String].self, from: Data(historyData.utf8))) ?? [] }
    var body: some View {
        VStack(spacing: 0) {
            if searchMode { HStack { TextField("番号、标题、演员或标签", text: $query).textFieldStyle(.roundedBorder).submitLabel(.search).onSubmit { submit() }; Button("搜索") { submit() } }.padding() }
            HStack(spacing: 12) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filter("片源", value: $source, items: sources)
                        filter("状态", value: $status, items: statuses)
                        filter("排序", value: $sort, items: [("added-desc", "最新加入"), ("release-desc", "最新发行")])
                    }
                }
                Button { grid.toggle() } label: { Image(systemName: grid ? "list.bullet" : "square.grid.2x2").frame(width: 44, height: 44) }
                    .accessibilityLabel(grid ? "切换为列表布局" : "切换为网格布局")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
            if searchMode && submitted.isEmpty {
                List { Section("最近搜索") { ForEach(history, id: \.self) { term in Button(term) { query = term; submit() } }; Button("清空历史", role: .destructive) { historyData = "[]" } } }
            } else {
                ScrollView { LazyVGrid(columns: grid ? Array(repeating: GridItem(.flexible(), spacing: 10), count: 3) : [GridItem(.flexible())], alignment: .leading, spacing: 18) {
                    ForEach(movies) { movie in NavigationLink { MovieDetail(movieID: movie.id) } label: { MovieCard(movie: movie, grid: grid) }.buttonStyle(.plain) }
                    if movies.count < total && error == nil { ProgressView().task { await load(reset: false) } }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
                if loading && movies.isEmpty { ProgressView().padding() }
                if movies.isEmpty && !loading && error == nil { ContentUnavailableView("没有找到影片", systemImage: "film") }
                if let error { Text(error).foregroundStyle(.red).padding(); Button("重试") { revision += 1 } }
                }.refreshable { await load(reset: true) }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !searchMode {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { LibraryView(title: "搜索", searchMode: true) } label: { Image(systemName: "magnifyingglass") }
                        .accessibilityLabel("搜索媒体库")
                }
            }
        }
        .task(id: "\(submitted)|\(status)|\(source)|\(sort)|\(revision)") { if !searchMode || !submitted.isEmpty { await load(reset: true) } }
    }
    func filter(_ title: String, value: Binding<String>, items: [(String, String)]) -> some View {
        Menu { Picker(title, selection: value) { ForEach(items, id: \.0) { Text($0.1).tag($0.0) } } }
        label: {
            HStack(spacing: 4) { Text(items.first(where: { $0.0 == value.wrappedValue })?.1 ?? title); Image(systemName: "chevron.down").font(.caption2) }
                .font(.subheadline)
                .padding(.horizontal, 12).frame(minHeight: 36)
                .background(.thinMaterial, in: Capsule())
        }
        .accessibilityLabel("筛选\(title)")
    }
    func submit() { let term = query.trimmingCharacters(in: .whitespacesAndNewlines); guard !term.isEmpty else { return }; var terms = history.filter { $0 != term }; terms.insert(term, at: 0); historyData = String(data: (try? JSONEncoder().encode(Array(terms.prefix(10)))) ?? Data(), encoding: .utf8) ?? "[]"; submitted = term; revision += 1 }
    func load(reset: Bool) async {
        guard let pairing = store.pairing else { return }
        if !reset && loading { return }; let id = UUID(); requestID = id; loading = true; defer { if requestID == id { loading = false } }
        do {
            let result = try await API(pairing: pairing).movies(page: reset ? 1 : page + 1, query: submitted, status: status, source: source, sort: sort, actor: actor, tag: tag)
            try Task.checkCancellation(); guard requestID == id else { return }; movies = reset ? result.items : movies + result.items.filter { item in !movies.contains(where: { $0.id == item.id }) }; page = result.page; total = result.total; error = nil
        } catch is CancellationError {} catch { if !Task.isCancelled && requestID == id { self.error = error.localizedDescription; store.handle(error) } }
    }
}
struct MediaImage: View {
    @EnvironmentObject var store: AppStore
    let path: String?
    let contentMode: ContentMode
    let alignment: Alignment
    var naturalAspect = false
    @State private var image: UIImage?
    @State private var failed = false
    @State private var loading = false

    init(path: String?, contentMode: ContentMode = .fill, alignment: Alignment = .center, naturalAspect: Bool = false) { self.path = path; self.contentMode = contentMode; self.alignment = alignment; self.naturalAspect = naturalAspect }

    var body: some View {
        Group {
            if naturalAspect {
                imageSurface
                    .aspectRatio(image.map { $0.size.width / max(1, $0.size.height) } ?? 1.5, contentMode: .fit)
            } else {
                imageSurface
            }
        }
        .clipped()
        .task(id: path) { await load() }
        .accessibilityLabel(image == nil ? "封面不可用" : "影片封面")
    }

    private var imageSurface: some View {
        Rectangle()
            .fill(Color.white.opacity(0.07))
            .overlay {
                GeometryReader { geometry in
                    ZStack {
                        if let image {
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: contentMode)
                                .transition(.opacity)
                        } else if loading {
                            ProgressView().controlSize(.small)
                        } else if failed {
                            Image(systemName: "photo.badge.exclamationmark")
                                .font(.title3)
                                .foregroundStyle(.secondary)
                        } else {
                            Image(systemName: "photo")
                                .font(.title3)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: geometry.size.width, height: geometry.size.height, alignment: alignment)
                }
            }
    }

    private func load() async {
        image = nil; failed = false; loading = false
        guard let path, let pairing = store.pairing else { return }
        let key = "\(pairing.baseURL)|\(pairing.serverId)|\(path)"
        if let cached = ImageMemoryCache.image(for: key) { image = cached; return }
        loading = true; defer { loading = false }
        do {
            let data = try await ImageDataLoader.shared.data(for: key) { try await API(pairing: pairing).data(path) }
            guard !Task.isCancelled, let decoded = UIImage(data: data) else { return }
            ImageMemoryCache.insert(decoded, for: key); withAnimation(.easeOut(duration: 0.2)) { image = decoded }
        } catch is CancellationError { }
        catch { failed = true; if case APIError.unauthorized = error { store.handle(error) } }
    }
}
struct MovieCard: View {
    let movie: Movie; let grid: Bool
    private let gridSideInset: CGFloat = 16
    private let gridSpacing: CGFloat = 10

    private var gridCoverWidth: CGFloat {
        max(1, (UIScreen.main.bounds.width - (gridSideInset * 2) - (gridSpacing * 2)) / 3)
    }

    private var gridCoverHeight: CGFloat { gridCoverWidth * 538.0 / 376.0 }

    var body: some View {
        Group {
            if grid {
                VStack(alignment: .leading, spacing: 6) {
                    MediaImage(path: movie.coverUrl, alignment: .trailing)
                        .frame(width: gridCoverWidth, height: gridCoverHeight)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text(movie.code ?? movie.title).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
                    Text(movie.title).font(.caption2).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.leading)
                }
                .contentShape(Rectangle())
            } else {
                HStack(spacing: 12) {
                    MediaImage(path: movie.coverUrl, contentMode: .fit, naturalAspect: true).frame(width: 132).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 6) { Text(movie.code ?? "").font(.headline).lineLimit(1); Text(movie.title).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                    Spacer(minLength: 0)
                }.frame(minHeight: 74).contentShape(Rectangle())
            }
        }
    }
}
struct MovieDetail: View {
    @EnvironmentObject var store: AppStore; let movieID: String
    @State private var movie: Movie?; @State private var error: String?; @State private var playing: RemoteFile?; @State private var updating = false
    var body: some View {
        ScrollView {
            if let movie {
                VStack(alignment: .leading, spacing: 0) {
                    MediaImage(path: movie.coverUrl, contentMode: .fit, naturalAspect: true)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(.bottom, 24)

                    VStack(alignment: .leading, spacing: 8) {
                        Text(movie.title)
                            .font(.title2.weight(.bold))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(movie.code ?? "未设置番号")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.purple)
                        Text([movie.releaseDate, movie.durationMinutes.map { "\($0) 分钟" }].compactMap { $0 }.joined(separator: "  ·  "))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.bottom, 28)

                    DetailSectionHeader(title: "观看状态")
                    Picker("观看状态", selection: Binding(get: { movie.watchStatus }, set: { next in Task { await setStatus(next) } })) {
                        ForEach(Array(statuses.dropFirst()), id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.segmented)
                    .disabled(updating)
                    .padding(.bottom, 28)

                    DetailSectionHeader(title: "播放版本")
                    if movie.files.isEmpty {
                        DetailEmptyRow(title: "没有可播放文件", systemImage: "film")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(movie.files) { file in
                                Button { if file.available { playing = file } } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: file.available ? "play.circle.fill" : "exclamationmark.triangle.fill")
                                            .font(.title3)
                                            .foregroundStyle(file.available ? .purple : .secondary)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(file.versionLabel ?? file.name).font(.body.weight(.medium)).lineLimit(1)
                                            Text(file.available ? "可播放" : "文件不可用").font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                                    }
                                    .frame(minHeight: 56)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(!file.available)
                                if file.id != movie.files.last?.id { Divider() }
                            }
                        }
                        .padding(.horizontal, 16)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    if let firstPlayable = movie.files.first(where: \.available) {
                        Button { playing = firstPlayable } label: {
                            Label("播放影片", systemImage: "play.fill")
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 12)
                    }

                    if !movie.actors.isEmpty {
                        DetailSectionHeader(title: "演员", topPadding: 28)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(movie.actors, id: \.self) { name in
                                    NavigationLink { ActorDetail(name: name) } label: { Text(name).detailChip() }
                                }
                            }
                        }
                    }

                    if !movie.tags.isEmpty {
                        DetailSectionHeader(title: "标签", topPadding: 24)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(movie.tags, id: \.self) { tag in
                                    NavigationLink { LibraryView(title: tag, tag: tag) } label: { Text(tag).detailChip() }
                                }
                            }
                        }
                    }

                    if !movie.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        DetailSectionHeader(title: "简介", topPadding: 28)
                        Text(movie.description)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 32)
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
            }
            if let error {
                VStack(spacing: 12) {
                    Text(error).foregroundStyle(.red).multilineTextAlignment(.center)
                    Button("重试") { Task { await load() } }.buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity)
                .padding(24)
            }
        }
        .navigationTitle("影片详情").task { await load() }.fullScreenCover(item: $playing, onDismiss: { Task { await load() } }) { file in if let movie, let pairing = store.pairing { PlayerView(movie: movie, file: file, pairing: pairing) } }
    }
    func load() async { guard let pairing = store.pairing else { return }; do { movie = try await API(pairing: pairing).movie(id: movieID); error = nil } catch { self.error = error.localizedDescription; store.handle(error) } }
    func setStatus(_ status: String) async { guard let pairing = store.pairing, let movie else { return }; updating = true; defer { updating = false }; do { try await API(pairing: pairing).progress(id: movie.id, position: movie.progressSeconds, duration: 0, status: status); self.movie?.watchStatus = status; error = nil } catch { self.error = error.localizedDescription; store.handle(error) } }
}
private struct DetailSectionHeader: View {
    let title: String
    var topPadding: CGFloat = 0
    var body: some View { Text(title).font(.headline).padding(.top, topPadding).padding(.bottom, 10) }
}
private struct DetailEmptyRow: View {
    let title: String; let systemImage: String
    var body: some View { Label(title, systemImage: systemImage).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(16).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous)) }
}
private extension Text {
    func detailChip() -> some View { self.font(.subheadline).foregroundStyle(.purple).padding(.horizontal, 12).frame(minHeight: 36).background(Color.purple.opacity(0.14), in: Capsule()) }
}
struct PeopleView: View {
    @EnvironmentObject var store: AppStore; @State private var actors: [Actor] = []; @State private var error: String?
    var body: some View { ScrollView { LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 18) { ForEach(actors) { actor in NavigationLink { ActorDetail(name: actor.name) } label: { VStack { MediaImage(path: actor.avatarUrl).frame(height: 140).clipShape(RoundedRectangle(cornerRadius: 12)); Text(actor.name).font(.caption) } } } }.padding(); if let error { Text(error).foregroundStyle(.red); Button("重试") { Task { await load() } } } }.navigationTitle("演员库").navigationBarTitleDisplayMode(.inline).task { await load() }.refreshable { await load() } }
    func load() async { guard let pairing = store.pairing else { return }; do { actors = try await API(pairing: pairing).request("/api/v1/actors"); error = nil } catch { self.error = error.localizedDescription; store.handle(error) } }
}
struct ActorDetail: View {
    @EnvironmentObject var store: AppStore; let name: String; @State private var actor: Actor?; @State private var error: String?
    var body: some View { List { if let actor { MediaImage(path: actor.avatarUrl).frame(height: 260); Text(actor.aliases.joined(separator: "、")); if let category = actor.category { Text(category) }; ForEach(actor.socialLinks, id: \.url) { link in if let url = URL(string: link.url), ["https", "http"].contains(url.scheme ?? "") { Link(link.platform, destination: url) } } }; NavigationLink("参演影片") { LibraryView(title: name, actor: name) }; if let error { Text(error).foregroundStyle(.red) } }.navigationTitle(name).task { guard let pairing = store.pairing else { return }; do { actor = try await API(pairing: pairing).request("/api/v1/actors/\(API.segment(name))") } catch { self.error = error.localizedDescription; store.handle(error) } } }
}
struct SettingsView: View {
    @EnvironmentObject var store: AppStore; @State private var confirm = false
    var body: some View { Form { Section("当前电脑") { Text(store.pairing?.baseURL ?? "未连接"); Button("重试连接") { Task { await store.connect() } }; if let error = store.error { Text(error).foregroundStyle(.red) }; Button("取消配对", role: .destructive) { confirm = true } }; Section("关于") { Text("AVault iOS 0.1"); Text("仅连接可信局域网，不提供离线下载。").foregroundStyle(.secondary) } }.navigationTitle("设置").navigationBarTitleDisplayMode(.inline).confirmationDialog("取消与当前电脑的配对？", isPresented: $confirm, titleVisibility: .visible) { Button("取消配对", role: .destructive) { store.clearPairing() } }
    }
}
