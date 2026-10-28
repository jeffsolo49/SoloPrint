import UIKit

struct Page: Identifiable {
    let id: Int
    let chapter: Int          // 1-based
    let text: NSAttributedString
}

/// Splits a book into pages that exactly fill `size`, using the same text
/// layout engine that draws them, so nothing is cut off. Each chapter starts
/// on a fresh page, like a printed Bible.
enum Paginator {
    static func pages(for book: Book, size: CGSize, fontSize: CGFloat, ink: UIColor, accent: UIColor) -> [Page] {
        guard size.width > 80, size.height > 80 else { return [] }
        var result: [Page] = []

        let body = UIFont(descriptor: UIFontDescriptor.preferredFontDescriptor(withTextStyle: .body)
            .withDesign(.serif) ?? UIFontDescriptor(), size: fontSize)
        let heading = UIFont(descriptor: UIFontDescriptor.preferredFontDescriptor(withTextStyle: .title1)
            .withDesign(.serif) ?? UIFontDescriptor(), size: fontSize * 1.7)
        let number = UIFont.systemFont(ofSize: fontSize * 0.6, weight: .semibold)

        let bodyStyle = NSMutableParagraphStyle()
        bodyStyle.lineSpacing = fontSize * 0.3
        bodyStyle.alignment = .natural
        let headStyle = NSMutableParagraphStyle()
        headStyle.paragraphSpacing = fontSize * 0.6

        for (index, verses) in book.chapters.enumerated() {
            let chapterNumber = index + 1
            let text = NSMutableAttributedString()
            text.append(NSAttributedString(
                string: "\(book.name) \(chapterNumber)\n",
                attributes: [.font: heading, .foregroundColor: ink, .paragraphStyle: headStyle]))
            for (verseIndex, verse) in verses.enumerated() {
                text.append(NSAttributedString(
                    string: "\(verseIndex + 1)\u{2009}",
                    attributes: [.font: number, .foregroundColor: accent, .baselineOffset: fontSize * 0.25,
                                 .paragraphStyle: bodyStyle]))
                text.append(NSAttributedString(
                    string: verse.trimmingCharacters(in: .whitespacesAndNewlines) + " ",
                    attributes: [.font: body, .foregroundColor: ink, .paragraphStyle: bodyStyle]))
            }

            let storage = NSTextStorage(attributedString: text)
            let layout = NSLayoutManager()
            storage.addLayoutManager(layout)
            while true {
                let container = NSTextContainer(size: size)
                container.lineFragmentPadding = 0
                layout.addTextContainer(container)
                let glyphs = layout.glyphRange(for: container)
                if glyphs.length == 0 { break }
                let chars = layout.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
                let slice = text.attributedSubstring(from: chars)
                result.append(Page(id: result.count, chapter: chapterNumber, text: slice))
                if NSMaxRange(glyphs) >= layout.numberOfGlyphs { break }
            }
        }
        return result
    }
}
