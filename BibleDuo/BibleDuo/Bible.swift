import Foundation

struct Book: Decodable, Identifiable, Hashable {
    let name: String
    let chapters: [[String]]
    var id: String { name }
}

enum Translation: String, CaseIterable, Identifiable {
    case kjv, bbe
    var id: String { rawValue }
    var title: String {
        switch self {
        case .kjv: return "King James Version"
        case .bbe: return "Bible in Basic English"
        }
    }
    var short: String { rawValue.uppercased() }
}

enum Bible {
    private static var cache: [Translation: [Book]] = [:]

    static func books(_ translation: Translation) -> [Book] {
        if let cached = cache[translation] { return cached }
        guard let url = Bundle.main.url(forResource: translation.rawValue, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let books = try? JSONDecoder().decode([Book].self, from: data) else { return [] }
        cache[translation] = books
        return books
    }

    /// Genesis through Malachi are the first 39 books.
    static let oldTestamentCount = 39
}
