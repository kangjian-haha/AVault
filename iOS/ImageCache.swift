import Foundation
import UIKit

actor ImageDataLoader {
    static let shared = ImageDataLoader()
    private var tasks: [String: Task<Data, Error>] = [:]

    func data(for key: String, request: @escaping @Sendable () async throws -> Data) async throws -> Data {
        if let task = tasks[key] { return try await task.value }
        let task = Task { try await request() }
        tasks[key] = task
        defer { tasks[key] = nil }
        return try await task.value
    }
}

final class ImageMemoryCache: @unchecked Sendable {
    static let shared = NSCache<NSString, UIImage>()
    private init() {}
}

extension ImageMemoryCache {
    static func image(for key: String) -> UIImage? { shared.object(forKey: key as NSString) }
    static func insert(_ image: UIImage, for key: String) { shared.setObject(image, forKey: key as NSString) }
}
