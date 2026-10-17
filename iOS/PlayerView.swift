import Foundation
import SwiftUI
import AVFoundation
import MediaPlayer
import UIKit

struct PlayerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var store: AppStore
    @Environment(\.scenePhase) private var scenePhase
    let movie: Movie
    let file: RemoteFile
    let pairing: Pairing

    @StateObject private var playback = Playback()
    @State private var controlsVisible = false
    @State private var hint: PlayerHint?
    @State private var previewTime: Double?
    @State private var hideTask: Task<Void, Never>?
    @State private var hideGeneration = 0
    @State private var gestureStartTime = 0.0
    @State private var gestureStartBrightness = 0.5
    @State private var gestureStartVolume = 0.5
    @State private var gestureStartSpeed = 1.0
    @State private var dragMode: DragMode?
    @State private var longPressActive = false
    @State private var isLandscape = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerSurface(player: playback.player).ignoresSafeArea()
            PlayerGestureLayer(
                onTap: { toggleControls() },
                onDoubleTap: { location, size in handleDoubleTap(location: location, size: size) },
                onLongPressBegan: { beginLongPress() },
                onLongPressEnded: { finishLongPress() },
                onDragChanged: { value, size in handleDragChanged(value, size: size) },
                onDragEnded: { value, size in handleDragEnded(value, size: size) }
            ).frame(maxWidth: .infinity, maxHeight: .infinity).ignoresSafeArea()
            if controlsVisible { PlayerControlsOverlay(playback: playback, onClose: closePlayer, onOrientation: toggleOrientation, isLandscape: isLandscape, onInteraction: scheduleHide) }
            if let hint { PlayerHintOverlay(hint: hint, previewTime: previewTime, duration: playback.duration) }
            if let error = playback.error { PlayerErrorOverlay(message: error, retry: { playback.open(file: file, position: 0) }) }
        }
        .task { playback.configure(movie: movie, pairing: pairing, onError: { store.handle($0) }); isLandscape = false; forcePortrait(); playback.open(file: file, position: 0) }
        .onDisappear { hideTask?.cancel(); playback.stop(); restoreOrientation() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { playback.player.pause(); Task { await playback.sync() } } }
    }

    private func toggleControls() {
        controlsVisible.toggle()
        if controlsVisible {
            scheduleHide()
        } else {
            hideGeneration &+= 1
            hideTask?.cancel()
            hint = nil
            previewTime = nil
        }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideGeneration &+= 1
        let generation = hideGeneration
        hideTask = Task { [generation] in
            do {
                try await Task.sleep(for: .seconds(3))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard generation == hideGeneration else { return }
                controlsVisible = false
                hint = nil
                previewTime = nil
            }
        }
    }
    private func showHint(_ value: PlayerHint, preview: Double? = nil) { hint = value; previewTime = preview; controlsVisible = true; scheduleHide() }
    private func handleDoubleTap(location: CGPoint, size: CGSize) { let delta = location.x < size.width / 2 ? -15.0 : 15.0; playback.seek(to: playback.currentTime + delta); showHint(delta < 0 ? .seekBackward : .seekForward) }

    private func beginLongPress() {
        guard !longPressActive else { return }
        longPressActive = true
        dragMode = nil
        previewTime = nil
        gestureStartSpeed = playback.playbackRate
        playback.setRate(2)
        showHint(.speed(2))
    }

    private func handleDragChanged(_ value: PlayerDragValue, size: CGSize) {
        if longPressActive {
            if value.translation.width > 70, playback.playbackRate != 5 {
                playback.setRate(5)
                showHint(.speed(5))
            } else if value.translation.width < 35, playback.playbackRate != 2 {
                playback.setRate(2)
                showHint(.speed(2))
            }
            return
        }
        if dragMode == nil {
            gestureStartTime = playback.currentTime; gestureStartBrightness = UIScreen.main.brightness; gestureStartVolume = VolumeController.shared.volume
            dragMode = abs(value.translation.width) >= abs(value.translation.height) ? .seek : (value.startLocation.x < size.width / 2 ? .brightness : .volume)
        }
        switch dragMode {
        case .seek:
            let target = min(max(gestureStartTime + Double(value.translation.width / max(size.width, 1)) * max(playback.duration, 1), 0), max(playback.duration, 0))
            previewTime = target; showHint(.seekPreview, preview: target)
        case .brightness:
            let next = min(max(gestureStartBrightness - value.translation.height / max(size.height, 1), 0.05), 1); UIScreen.main.brightness = next; showHint(.brightness(next))
        case .volume:
            let next = min(max(gestureStartVolume - value.translation.height / max(size.height, 1), 0), 1); VolumeController.shared.volume = next; showHint(.volume(next))
        case .none: break
        }
    }

    private func handleDragEnded(_ value: PlayerDragValue, size: CGSize) {
        if !longPressActive, dragMode == .seek, let previewTime { playback.seek(to: previewTime) }
        dragMode = nil; previewTime = nil
        scheduleHide()
    }

    private func finishLongPress() {
        guard longPressActive else { return }
        longPressActive = false
        playback.setRate(gestureStartSpeed)
        showHint(.speed(gestureStartSpeed))
    }

    private func closePlayer() { Task { await playback.sync(); playback.player.pause(); dismiss() } }
    private func toggleOrientation() { if isLandscape { isLandscape = false; forcePortrait() } else { isLandscape = true; forceLandscape() } }
    private func forceLandscape() { AppDelegate.orientationMask = .landscape; UIDevice.current.setValue(UIInterfaceOrientation.landscapeRight.rawValue, forKey: "orientation"); if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in } }; UIViewController.attemptRotationToDeviceOrientation() }
    private func forcePortrait() { AppDelegate.orientationMask = .portrait; UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation"); if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in } }; UIViewController.attemptRotationToDeviceOrientation() }
    private func restoreOrientation() { AppDelegate.orientationMask = .all; if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .all)) { _ in } }; UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation"); UIViewController.attemptRotationToDeviceOrientation() }
}

private enum DragMode { case seek, brightness, volume }
private enum PlayerHint: Equatable { case seekBackward, seekForward, seekPreview, brightness(Double), volume(Double), speed(Double) }

private struct PlayerControlsOverlay: View {
    @ObservedObject var playback: Playback
    let onClose: () -> Void
    let onOrientation: () -> Void
    let isLandscape: Bool
    let onInteraction: () -> Void
    @State private var isScrubbing = false
    @State private var scrubTime = 0.0
    var body: some View {
        VStack(spacing: 0) {
            HStack { Button { onClose() } label: { Image(systemName: "chevron.left").font(.title3.weight(.semibold)).frame(width: 44, height: 44) }.accessibilityLabel("返回影片详情"); Spacer() }.padding(.top, 12).padding(.horizontal, 16)
            Spacer()
            HStack(spacing: 28) {
                Button { playback.seek(to: playback.currentTime - 15); onInteraction() } label: { Image(systemName: "gobackward.15").font(.system(size: 36, weight: .medium)).frame(width: 64, height: 64) }.accessibilityLabel("后退 15 秒")
                Button { playback.togglePlayPause(); onInteraction() } label: { Image(systemName: playback.isPlaying ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 54, weight: .regular)).frame(width: 72, height: 72) }.accessibilityLabel(playback.isPlaying ? "暂停" : "播放")
                Button { playback.seek(to: playback.currentTime + 15); onInteraction() } label: { Image(systemName: "goforward.15").font(.system(size: 36, weight: .medium)).frame(width: 64, height: 64) }.accessibilityLabel("前进 15 秒")
            }
            VStack(spacing: 8) {
                Slider(
                    value: Binding(
                        get: { isScrubbing ? scrubTime : playback.currentTime },
                        set: { scrubTime = min(max($0, 0), max(playback.duration, 0)) }
                    ),
                    in: 0...max(playback.duration, 0.1),
                    onEditingChanged: { editing in
                        isScrubbing = editing
                        if editing {
                            scrubTime = playback.currentTime
                        } else {
                            playback.seek(to: scrubTime)
                        }
                        onInteraction()
                    }
                ).tint(.white).accessibilityLabel("播放进度")
                HStack {
                    Text(timeLabel(playback.currentTime)); Spacer(); Text(timeLabel(playback.duration))
                    Menu {
                        ForEach([0.5, 1.0, 1.25, 1.5, 2.0], id: \.self) { speed in
                            Button { playback.setRate(speed); onInteraction() } label: {
                                HStack { Text(String(format: "%.2gx", speed)); if abs(playback.playbackRate - speed) < 0.01 { Image(systemName: "checkmark") } }
                            }
                        }
                    } label: {
                        Text(String(format: "%.2gx", playback.playbackRate)).frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("播放速度")
                    Button { onOrientation() } label: { Image(systemName: isLandscape ? "rectangle.portrait.rotate" : "rectangle.landscape.rotate").font(.title3).frame(width: 44, height: 44) }.accessibilityLabel(isLandscape ? "切换并锁定竖屏" : "切换并锁定横屏")
                }.font(.caption.monospacedDigit())
            }.padding(.horizontal, 16).padding(.bottom, 20)
        }
        .foregroundStyle(.white)
        .background {
            LinearGradient(colors: [.black.opacity(0.72), .clear, .black.opacity(0.86)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        }
        .transition(.opacity)
    }
    private func timeLabel(_ seconds: Double) -> String { let total = max(0, Int(seconds.isFinite ? seconds.rounded(.down) : 0)); return String(format: "%02d:%02d", total / 60, total % 60) }
}

private struct PlayerDragValue {
    let translation: CGSize
    let startLocation: CGPoint
}

private struct PlayerGestureLayer: UIViewRepresentable {
    let onTap: () -> Void
    let onDoubleTap: (CGPoint, CGSize) -> Void
    let onLongPressBegan: () -> Void
    let onLongPressEnded: () -> Void
    let onDragChanged: (PlayerDragValue, CGSize) -> Void
    let onDragEnded: (PlayerDragValue, CGSize) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> UIView {
        let view = GestureView()
        view.backgroundColor = .clear
        view.isMultipleTouchEnabled = false

        let singleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleSingleTap(_:)))
        singleTap.numberOfTapsRequired = 1
        singleTap.cancelsTouchesInView = false

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        doubleTap.cancelsTouchesInView = false

        let longPress = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleLongPress(_:)))
        longPress.minimumPressDuration = 0.45
        longPress.allowableMovement = 30
        longPress.cancelsTouchesInView = false

        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
        pan.minimumNumberOfTouches = 1
        pan.maximumNumberOfTouches = 1
        pan.cancelsTouchesInView = false

        singleTap.require(toFail: doubleTap)
        singleTap.require(toFail: longPress)
        singleTap.delegate = context.coordinator
        doubleTap.delegate = context.coordinator
        longPress.delegate = context.coordinator
        pan.delegate = context.coordinator
        view.addGestureRecognizer(singleTap)
        view.addGestureRecognizer(doubleTap)
        view.addGestureRecognizer(longPress)
        view.addGestureRecognizer(pan)
        context.coordinator.singleTap = singleTap
        context.coordinator.doubleTap = doubleTap
        context.coordinator.longPress = longPress
        context.coordinator.pan = pan
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: PlayerGestureLayer
        weak var singleTap: UITapGestureRecognizer?
        weak var doubleTap: UITapGestureRecognizer?
        weak var longPress: UILongPressGestureRecognizer?
        weak var pan: UIPanGestureRecognizer?
        private var dragStartLocation = CGPoint.zero

        init(parent: PlayerGestureLayer) { self.parent = parent }

        @objc func handleSingleTap(_ recognizer: UITapGestureRecognizer) {
            parent.onTap()
        }

        @objc func handleDoubleTap(_ recognizer: UITapGestureRecognizer) {
            guard let view = recognizer.view else { return }
            parent.onDoubleTap(recognizer.location(in: view), view.bounds.size)
        }

        @objc func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
            switch recognizer.state {
            case .began:
                parent.onLongPressBegan()
            case .ended, .cancelled, .failed:
                parent.onLongPressEnded()
            default:
                break
            }
        }

        @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
            guard let view = recognizer.view else { return }
            let point = recognizer.translation(in: view)
            let translation = CGSize(width: point.x, height: point.y)
            let value = PlayerDragValue(translation: translation, startLocation: dragStartLocation)
            switch recognizer.state {
            case .began:
                dragStartLocation = recognizer.location(in: view)
                parent.onDragChanged(PlayerDragValue(translation: .zero, startLocation: dragStartLocation), view.bounds.size)
            case .changed:
                parent.onDragChanged(value, view.bounds.size)
            case .ended, .cancelled, .failed:
                parent.onDragEnded(value, view.bounds.size)
            default:
                break
            }
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            false
        }
    }

    private final class GestureView: UIView {
        override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { true }
    }
}

private struct PlayerHintOverlay: View {
    let hint: PlayerHint; let previewTime: Double?; let duration: Double
    var body: some View { VStack { Text(text).font(.caption.weight(.semibold).monospacedDigit()).padding(.horizontal, 12).padding(.vertical, 7).background(.black.opacity(0.62), in: Capsule()); Spacer() }.padding(.top, 28).foregroundStyle(.white).allowsHitTesting(false) }
    private var text: String { switch hint { case .seekBackward: return "后退 15 秒"; case .seekForward: return "前进 15 秒"; case .seekPreview: return "跳转至 \(timeLabel(previewTime ?? 0))"; case .brightness(let value): return "亮度 \(Int(value * 100))%"; case .volume(let value): return "音量 \(Int(value * 100))%"; case .speed(let value): return String(format: "%.0f 倍速", value) } }
    private func timeLabel(_ seconds: Double) -> String { let total = max(0, Int(seconds.rounded(.down))); return String(format: "%02d:%02d", total / 60, total % 60) }
}

private struct PlayerErrorOverlay: View { let message: String; let retry: () -> Void; var body: some View { VStack(spacing: 12) { Text(message).multilineTextAlignment(.center).padding().background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12)); Button("重试播放", action: retry).buttonStyle(.borderedProminent) }.padding() } }

private struct PlayerSurface: UIViewRepresentable {
    let player: AVPlayer
    func makeUIView(context: Context) -> PlayerSurfaceView { let view = PlayerSurfaceView(); view.player = player; return view }
    func updateUIView(_ view: PlayerSurfaceView, context: Context) { view.player = player }
}
private final class PlayerSurfaceView: UIView { override static var layerClass: AnyClass { AVPlayerLayer.self }; private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }; var player: AVPlayer? { get { playerLayer.player } set { playerLayer.player = newValue; playerLayer.videoGravity = .resizeAspect } } }

private final class VolumeController {
    static let shared = VolumeController()
    private let volumeView = MPVolumeView(frame: CGRect(x: -1000, y: -1000, width: 1, height: 1))
    private var slider: UISlider? { volumeView.subviews.compactMap { $0 as? UISlider }.first }
    var volume: Double { get { Double(slider?.value ?? AVAudioSession.sharedInstance().outputVolume) } set { slider?.value = Float(min(max(newValue, 0), 1)); slider?.sendActions(for: .valueChanged) } }
    private init() { volumeView.showsRouteButton = false; volumeView.showsVolumeSlider = true; if let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first { window.addSubview(volumeView) } }
}

@MainActor final class Playback: ObservableObject {
    let player = AVPlayer()
    @Published var error: String?
    @Published var currentTime = 0.0
    @Published var duration = 0.0
    @Published var isPlaying = false
    @Published var playbackRate = 1.0
    private var movie: Movie?
    private var pairing: Pairing?
    private var onError: ((Error) -> Void)?
    private var timer: Task<Void, Never>?
    private var progressTimer: Task<Void, Never>?
    private var videoMonitor: Task<Void, Never>?
    private var observation: NSKeyValueObservation?
    private var pauseObservation: NSKeyValueObservation?
    private var notification: NSObjectProtocol?
    private var seekGeneration = 0
    private var isSeeking = false
    private var pendingSeekTime: Double?
    private var wantsPlayback = false
    private var actualPosition: Double {
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? max(0, seconds) : 0
    }
    var position: Double { pendingSeekTime ?? actualPosition }

    func configure(movie: Movie, pairing: Pairing, onError: @escaping (Error) -> Void) {
        self.movie = movie; self.pairing = pairing; self.onError = onError
        pauseObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in Task { @MainActor in self?.isPlaying = player.timeControlStatus == .playing; if player.timeControlStatus == .paused, player.currentItem != nil { await self?.sync() } } }
        timer?.cancel(); timer = Task { [weak self] in while !Task.isCancelled { try? await Task.sleep(for: .seconds(15)); await self?.sync() } }
        progressTimer?.cancel(); progressTimer = Task { [weak self] in while !Task.isCancelled { try? await Task.sleep(for: .milliseconds(200)); guard !Task.isCancelled else { return }; await MainActor.run { guard let self else { return }; let actual = self.actualPosition; if let pending = self.pendingSeekTime { self.currentTime = pending; if abs(actual - pending) < 0.5 { self.pendingSeekTime = nil; self.isSeeking = false; self.currentTime = actual } } else if !self.isSeeking { self.currentTime = actual }; let value = self.player.currentItem?.duration.seconds ?? 0; self.duration = value.isFinite ? max(0, value) : 0; self.isPlaying = self.player.timeControlStatus == .playing } } }
        notification = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in await self?.sync() } }
    }

    func open(file: RemoteFile, position: Double) {
        guard let pairing else { return }
        error = nil
        videoMonitor?.cancel()
        do {
            let url = try API(pairing: pairing).url("/api/v1/files/\(API.segment(file.id))/stream")
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": ["Authorization": "Bearer \(pairing.token)"]])
            let item = AVPlayerItem(asset: asset)
            observation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                if item.status == .failed {
                    Task { @MainActor in self?.error = "无法播放此文件。iOS 可能不支持此容器或编码。" }
                }
            }
            playbackRate = 1
            player.defaultRate = 1
            wantsPlayback = true
            player.pause()
            player.replaceCurrentItem(with: item)
            player.rate = 0
            let startTime = max(0, position)
            currentTime = startTime
            duration = 0
            seekGeneration &+= 1
            let generation = seekGeneration
            isSeeking = true
            pendingSeekTime = startTime
            player.seek(to: CMTime(seconds: startTime, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak item] finished in
                Task { @MainActor [weak self, weak item] in
                    guard finished, let self, let item, self.player.currentItem === item, self.seekGeneration == generation else { return }
                    self.player.playImmediately(atRate: 1)
                }
            }
            videoMonitor = Task { [weak self, weak item] in
                for _ in 0..<8 {
                    try? await Task.sleep(for: .seconds(1))
                    guard !Task.isCancelled else { return }
                    if let item, item.status == .readyToPlay, item.presentationSize.width > 0, item.presentationSize.height > 0 { return }
                }
                guard let self, let item, item.status == .readyToPlay, self.player.timeControlStatus == .playing else { return }
                self.error = "视频轨道无法显示。该文件可能使用了当前 iPhone 不支持的 H.264/H.265 编码或容器格式。"
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
    func togglePlayPause() {
        if player.timeControlStatus == .playing || wantsPlayback {
            wantsPlayback = false
            player.pause()
        } else {
            wantsPlayback = true
            player.playImmediately(atRate: Float(playbackRate))
        }
    }
    func setRate(_ value: Double) {
        playbackRate = min(max(value, 0.5), 5)
        player.defaultRate = Float(playbackRate)
        if wantsPlayback { player.playImmediately(atRate: Float(playbackRate)) }
    }
    func seek(to seconds: Double) {
        guard seconds.isFinite else { return }
        let upperBound = duration > 0 ? duration : max(seconds, currentTime)
        let value = max(0, min(seconds, upperBound))
        let resumeAfterSeek = wantsPlayback || player.timeControlStatus == .playing
        currentTime = value
        pendingSeekTime = value
        seekGeneration &+= 1
        let generation = seekGeneration
        isSeeking = true
        if resumeAfterSeek {
            wantsPlayback = true
            player.pause()
        }
        player.seek(to: CMTime(seconds: value, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
            Task { @MainActor [weak self] in
                guard let self, self.seekGeneration == generation else { return }
                guard finished else {
                    self.pendingSeekTime = nil
                    self.isSeeking = false
                    self.currentTime = self.actualPosition
                    return
                }
                if resumeAfterSeek { self.player.playImmediately(atRate: Float(self.playbackRate)) }
            }
        }
    }
    func sync() async { guard let pairing, let movie else { return }; do { try await API(pairing: pairing).progress(id: movie.id, position: position, duration: player.currentItem?.duration.seconds ?? 0) } catch { self.error = "播放进度同步失败：\(error.localizedDescription)"; onError?(error) } }
    func stop() { timer?.cancel(); progressTimer?.cancel(); videoMonitor?.cancel(); seekGeneration &+= 1; pendingSeekTime = nil; isSeeking = false; observation = nil; pauseObservation = nil; if let notification { NotificationCenter.default.removeObserver(notification); self.notification = nil }; player.pause(); Task { await sync(); player.replaceCurrentItem(with: nil) } }
}
