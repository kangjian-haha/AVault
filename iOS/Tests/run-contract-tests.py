#!/usr/bin/env python3
"""Run the production Foundation models/API against a local URLProtocol stub."""
from pathlib import Path
import subprocess
import tempfile
source = (Path(__file__).resolve().parents[1] / 'AppStore.swift').read_text()
models = source[source.index('struct Pairing:'):source.index('enum PairingKeychain')]
api = source[source.index('struct Health:'):source.index('@MainActor final class ServerDiscovery')]
tests = r'''
final class Stub: URLProtocol {
    static var response = "{}"
    static var status = 200
    static var inspect: ((URLRequest) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.inspect?(request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.response.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
func check(_ condition: @autoclosure () -> Bool, _ message: String) { if !condition() { fatalError(message) } }
@main struct ContractTests {
    static func main() async throws {
        URLProtocol.registerClass(Stub.self)
        let qr = PairingPayload(version: 1, serverId: "server", host: "192.168.1.2", port: 1234, nonce: "1234567890123456", expiresAt: "2099-01-01T00:00:00.000Z")
        try qr.validate(); check(qr.baseURL == "http://192.168.1.2:1234", "QR URL")
        do { try qr.validate(now: Date.distantFuture); fatalError("Expired QR accepted") } catch {}
        let bad = PairingPayload(version: 2, serverId: "server", host: "host/path", port: 0, nonce: "short", expiresAt: qr.expiresAt)
        do { try bad.validate(); fatalError("Malformed QR accepted") } catch {}
        let api = API(pairing: Pairing(serverId: "server", baseURL: qr.baseURL, token: "test-token"))
        do { _ = try api.url("https://other.example/image"); fatalError("Foreign host accepted") } catch {}
        Stub.inspect = { request in
            check(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token", "Missing auth")
            let c = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            check(c.queryItems?.contains(URLQueryItem(name: "actor", value: "名字 / &")) == true, "Actor escaping")
            check(c.queryItems?.contains(URLQueryItem(name: "page", value: "2")) == true, "Pagination")
        }
        Stub.response = #"{"items":[{"id":"m1","code":null,"title":"Movie","description":"","releaseDate":null,"durationMinutes":null,"actors":[],"tags":[],"coverUrl":"/api/v1/images/m1","watchStatus":"unwatched","progressSeconds":1.5,"files":[{"id":"f1","name":"a.mp4","versionLabel":null,"available":true}]}],"page":2,"total":31}"#
        let page = try await api.movies(page: 2, query: "test", status: "watching", source: "fc2", sort: "release-desc", actor: "名字 / &")
        check(page.items[0].coverUrl == "/api/v1/images/m1", "coverUrl wire key")
        check(page.items[0].progressSeconds == 1.5, "Fractional progress")
        Stub.inspect = { request in
            check(request.httpMethod == "PUT", "Progress method")
            var bytes = request.httpBody ?? Data()
            if bytes.isEmpty, let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; bytes.append(buffer, count: count) }
            }
            let body = try! JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            check(body["progressSeconds"] as? Double == 12, "Progress seconds")
            check(body["durationSeconds"] as? Double == 120, "Duration seconds")
            check(body["status"] == nil, "Playback must not change watch status")
        }
        Stub.response = #"{"ok":true}"#
        try await api.progress(id: "m1", position: 12, duration: 120)
        Stub.inspect = nil; Stub.status = 401
        do { let _: Health = try await api.request("/api/v1/health"); fatalError("401 accepted") } catch APIError.unauthorized {} 
        print("PASS: pairing validation, origin protection, API authentication, query encoding, pagination, response decoding, progress contract, revoked authorization")
    }
}
'''
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / 'ContractTests.swift'
    path.write_text('import Foundation\n' + models + api + tests)
    binary = Path(tmp) / 'tests'
    subprocess.run(['swiftc', '-parse-as-library', str(path), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
