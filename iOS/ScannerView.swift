import SwiftUI
import AVFoundation

struct ScannerView: View {
    @Environment(\.dismiss) private var dismiss
    let onScan: (String) -> Void
    @State private var permission = AVCaptureDevice.authorizationStatus(for: .video)
    var body: some View { NavigationStack {
        Group { if permission == .authorized { CameraScanner(onScan: onScan).ignoresSafeArea() } else { ContentUnavailableView { Label("需要相机权限", systemImage: "camera") } description: { Text("请允许 AVault 使用相机扫描电脑端配对二维码。也可以返回粘贴二维码 JSON。") } actions: { Button("打开系统设置") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } } } } }
        .navigationTitle("扫描配对二维码").toolbar { Button("关闭") { dismiss() } }
        .task { if permission == .notDetermined { _ = await AVCaptureDevice.requestAccess(for: .video); permission = AVCaptureDevice.authorizationStatus(for: .video) } }
    } }
}
struct CameraScanner: UIViewControllerRepresentable {
    let onScan: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerController { ScannerController(onScan: onScan) }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
    static func dismantleUIViewController(_ controller: ScannerController, coordinator: ()) { controller.stop() }
}
final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "avault.camera")
    private var preview: AVCaptureVideoPreviewLayer?
    private var scanned = false
    let onScan: (String) -> Void
    init(onScan: @escaping (String) -> Void) { self.onScan = onScan; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func viewDidLoad() {
        super.viewDidLoad()
        guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
            let label = UILabel(frame: view.bounds); label.text = "相机不可用，请返回粘贴二维码 JSON"; label.textColor = .white; label.textAlignment = .center; label.autoresizingMask = [.flexibleWidth, .flexibleHeight]; view.addSubview(label); return
        }
        session.addInput(input); let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }; session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main); output.metadataObjectTypes = [.qr]
        let layer = AVCaptureVideoPreviewLayer(session: session); layer.videoGravity = .resizeAspectFill; view.layer.addSublayer(layer); preview = layer
        queue.async { [session] in session.startRunning() }
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    func stop() { queue.async { [session] in session.stopRunning() } }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !scanned, let code = objects.first as? AVMetadataMachineReadableCodeObject, let value = code.stringValue else { return }; scanned = true; stop(); onScan(value)
    }
}
