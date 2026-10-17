import Foundation
import SwiftUI
import Security

struct Pairing: Codable { let serverId: String; var baseURL: String; let token: String }
struct RemoteFile: Codable, Identifiable { let id: String; let name: String; let versionLabel: String?; let available: Bool }
struct Movie: Codable, Identifiable {
    let id: String; let code: String?; let title: String; let description: String
    let releaseDate: String?; let durationMinutes: Int?; let actors: [String]; let tags: [String]
    let coverUrl: String?; var watchStatus: String; var progressSeconds: Double; let files: [RemoteFile]
}
struct MoviePage: Codable { let items: [Movie]; let page: Int; let total: Int }
struct SocialLink: Codable { let platform: String; let url: String }
struct Actor: Codable, Identifiable {
    var id: String { name }; let name: String; let avatarUrl: String?; let category: String?
    let aliases: [String]; let socialLinks: [SocialLink]
}
struct Tag: Codable, Identifiable { var id: String { name }; let name: String; let movieCount: Int }
enum APIError: LocalizedError {
    case unauthorized, message(String)
    var errorDescription: String? { switch self { case .unauthorized: return "设备授权已撤销，请重新扫码配对"; case .message(let message): return message } }
}

enum PairingKeychain {
    static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.avault.ios", kSecAttrAccount as String: "pairing"] }
    static func load() -> Pairing? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }
    static func save(_ pairing: Pairing) throws {
        let data = try JSONEncoder().encode(pairing)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw APIError.message("无法安全保存配对信息") }; return
        }
        guard status == errSecSuccess else { throw APIError.message("无法更新配对信息") }
    }
    static func clear() { SecItemDelete(query as CFDictionary) }
}

@MainActor final class AppStore: ObservableObject {
    @Published var pairing = PairingKeychain.load()
    @Published var connecting = false
    @Published var connected = false
    @Published var error: String?
    func handle(_ error: Error) { if case APIError.unauthorized = error { clearPairing() }; self.error = error.localizedDescription }
    func clearPairing() { pairing = nil; connected = false; PairingKeychain.clear() }
    private let discovery = ServerDiscovery()
    func verify(_ pairing: Pairing) async throws {
        let health: Health = try await API(pairing: pairing).request("/api/v1/health", authenticated: false)
        guard health.serverId == pairing.serverId else { throw APIError.message("服务器身份不匹配，请重新扫码") }
        let _: [Tag] = try await API(pairing: pairing).request("/api/v1/tags")
    }
    func connect() async {
        guard let pairing, !connecting else { return }; connecting = true; defer { connecting = false }
        do {
            try await verify(pairing)
            connected = true; error = nil
        } catch APIError.unauthorized { handle(APIError.unauthorized) }
        catch {
            connected = false
            if let baseURL = await discovery.find(serverID: pairing.serverId) {
                do {
                    var updated = pairing; updated.baseURL = baseURL
                    try await verify(updated); try PairingKeychain.save(updated)
                    self.pairing = updated; connected = true; self.error = nil; return
                } catch { handle(error); return }
            }
            self.error = "无法连接电脑，请确认 AVault 已运行且设备处于同一局域网。\n" + error.localizedDescription
        }
    }
    func pair(payload: String) async {
        guard !connecting else { return }; connecting = true; defer { connecting = false }
        do {
            let qr = try JSONDecoder().decode(PairingPayload.self, from: Data(payload.utf8)); try qr.validate()
            let candidate = Pairing(serverId: qr.serverId, baseURL: qr.baseURL, token: "")
            let result: PairResponse = try await API(pairing: candidate).request("/api/v1/pair", method: "POST", body: JSONSerialization.data(withJSONObject: ["nonce": qr.nonce, "deviceName": UIDevice.current.name]), authenticated: false)
            guard result.serverId == qr.serverId, !result.token.isEmpty else { throw APIError.message("配对服务器身份不匹配") }
            let saved = Pairing(serverId: qr.serverId, baseURL: qr.baseURL, token: result.token)
            try PairingKeychain.save(saved); pairing = saved; connected = true; error = nil
        } catch { handle(error) }
    }
}
struct Health: Decodable { let serverId: String }
struct PairResponse: Decodable { let serverId: String; let token: String }
struct PairingPayload: Decodable {
    let version: Int; let serverId: String; let host: String; let port: Int; let nonce: String; let expiresAt: String
    var baseURL: String { var c = URLComponents(); c.scheme = "http"; c.host = host; c.port = port; return c.url?.absoluteString ?? "" }
    func validate(now: Date = Date()) throws {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
        guard version == 1, !serverId.trimmingCharacters(in: .whitespaces).isEmpty, !host.isEmpty, !host.contains("/"), !host.contains("@"), (1...65535).contains(port), nonce.count >= 16, !baseURL.isEmpty else { throw APIError.message("配对二维码内容无效") }
        guard let date, date > now else { throw APIError.message("二维码已失效，请在电脑端重新生成") }
    }
}

struct API {
    let pairing: Pairing
    static func segment(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
    func url(_ path: String) throws -> URL {
        guard let url = URL(string: path, relativeTo: URL(string: pairing.baseURL)), let origin = URL(string: pairing.baseURL), url.host == origin.host, url.port == origin.port, url.scheme == origin.scheme else { throw APIError.message("无效的媒体地址") }
        return url.absoluteURL
    }
    func data(_ path: String, method: String = "GET", body: Data? = nil, authenticated: Bool = true) async throws -> Data {
        var request = URLRequest(url: try url(path)); request.timeoutInterval = 15
        request.httpMethod = method; request.httpBody = body
        if authenticated { request.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization") }
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if authenticated && [401, 403].contains(http.statusCode) { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"]
            throw APIError.message(message ?? "服务器返回 HTTP \(http.statusCode)")
        }
        return data
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, authenticated: Bool = true) async throws -> T {
        try await JSONDecoder().decode(T.self, from: data(path, method: method, body: body, authenticated: authenticated))
    }
    func movies(page: Int, query: String, status: String, source: String, sort: String, actor: String? = nil, tag: String? = nil) async throws -> MoviePage {
        var c = URLComponents(); c.path = "/api/v1/movies"
        c.queryItems = [URLQueryItem(name: "page", value: String(page)), URLQueryItem(name: "pageSize", value: "30"), URLQueryItem(name: "q", value: query), URLQueryItem(name: "sort", value: sort)]
        for (key, value) in [("status", status), ("sourcePartition", source), ("actor", actor ?? ""), ("tag", tag ?? "")] where !value.isEmpty { c.queryItems?.append(URLQueryItem(name: key, value: value)) }
        return try await request(c.string!)
    }
    func movie(id: String) async throws -> Movie { try await request("/api/v1/movies/\(Self.segment(id))") }
    func progress(id: String, position: Double, duration: Double, status: String? = nil) async throws {
        var body: [String: Any] = ["progressSeconds": max(0, position.isFinite ? position : 0), "durationSeconds": max(0, duration.isFinite ? duration : 0)]
        if let status { body["status"] = status }
        _ = try await data("/api/v1/movies/\(Self.segment(id))/progress", method: "PUT", body: JSONSerialization.data(withJSONObject: body))
    }
}

@MainActor final class ServerDiscovery: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var continuation: CheckedContinuation<String?, Never>?
    private var serverID = ""
    private var timeout: Task<Void, Never>?
    func find(serverID: String) async -> String? {
        self.serverID = serverID
        return await withCheckedContinuation { continuation in
            self.continuation = continuation; browser.delegate = self
            browser.searchForServices(ofType: "_avault._tcp.", inDomain: "local.")
            timeout = Task { try? await Task.sleep(for: .seconds(8)); if !Task.isCancelled { finish(nil) } }
        }
    }
    private func finish(_ address: String?) {
        guard let continuation else { return }; self.continuation = nil
        browser.stop(); services.forEach { $0.stop() }; services = []; timeout?.cancel(); timeout = nil
        continuation.resume(returning: address)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service); service.delegate = self; service.resolve(withTimeout: 5)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) { finish(nil) }
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let data = sender.txtRecordData(), let id = NetService.dictionary(fromTXTRecord: data)["serverId"], String(data: id, encoding: .utf8) == serverID,
              let host = sender.hostName, (1...65535).contains(sender.port) else { return }
        var c = URLComponents(); c.scheme = "http"; c.host = host; c.port = sender.port
        finish(c.url?.absoluteString)
    }
}
