import SwiftUI

struct ReaderView: View {
    @AppStorage("translation") private var translationRaw = Translation.kjv.rawValue
    @AppStorage("bookIndex") private var bookIndex = 0
    @AppStorage("chapter") private var chapter = 1
    @AppStorage("fontSize") private var fontSize = 19.0
    @Environment(\.colorScheme) private var scheme

    @State private var pages: [Page] = []
    @State private var first = 0          // index of the left (or only) page
    @State private var forward = true
    @State private var showPicker = false

    private var translation: Translation { Translation(rawValue: translationRaw) ?? .kjv }
    private var books: [Book] { Bible.books(translation) }
    private var book: Book? { books.indices.contains(bookIndex) ? books[bookIndex] : nil }

    private var paper: Color {
        scheme == .dark ? Color(red: 0.11, green: 0.10, blue: 0.09) : Color(red: 0.97, green: 0.94, blue: 0.87)
    }
    private var ink: UIColor {
        scheme == .dark ? UIColor(white: 0.9, alpha: 1) : UIColor(red: 0.15, green: 0.12, blue: 0.10, alpha: 1)
    }
    private var accent: UIColor {
        scheme == .dark ? UIColor(red: 0.90, green: 0.60, blue: 0.50, alpha: 1)
                        : UIColor(red: 0.55, green: 0.25, blue: 0.20, alpha: 1)
    }

    var body: some View {
        GeometryReader { geo in
            // Unfolded (wide) shows two pages like an open book; folded shows one.
            let spread = geo.size.width >= 560
            let margin: CGFloat = 24
            let gutter: CGFloat = spread ? 44 : 0
            let pageW = spread ? (geo.size.width - margin * 2 - gutter) / 2 : geo.size.width - margin * 2
            let pageH = max(0, geo.size.height - 52 - 44)
            let pageSize = CGSize(width: pageW.rounded(.down), height: pageH.rounded(.down))
            let key = "\(translationRaw)|\(bookIndex)|\(Int(pageSize.width))x\(Int(pageSize.height))|\(fontSize)|\(scheme)"

            VStack(spacing: 0) {
                header
                    .frame(height: 52)
                    .padding(.horizontal, margin)
                ZStack {
                    HStack(alignment: .top, spacing: gutter) {
                        pageView(first, size: pageSize)
                        if spread { pageView(first + 1, size: pageSize) }
                    }
                    .id(first)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .offset(x: forward ? 40 : -40)),
                        removal: .opacity))
                    if spread {
                        LinearGradient(colors: [.clear, .black.opacity(0.14), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: gutter)
                            .allowsHitTesting(false)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .clipped()
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 30).onEnded { value in
                    if value.translation.width < -40 { turn(1, spread: spread) }
                    else if value.translation.width > 40 { turn(-1, spread: spread) }
                })
                footer(spread: spread)
                    .frame(height: 44)
                    .padding(.horizontal, margin)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .background(paper.ignoresSafeArea())
            .task(id: key) { await repaginate(size: pageSize, spread: spread) }
            .sheet(isPresented: $showPicker) {
                PickerView(books: books) { b, c in
                    chapter = c
                    if b == bookIndex { snap(to: c, spread: spread) } else { bookIndex = b }
                }
            }
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack {
            Button { showPicker = true } label: {
                HStack(spacing: 6) {
                    Text("\(book?.name ?? "Bible") \(chapter)").font(.headline)
                    Image(systemName: "chevron.down").font(.caption)
                }
            }
            Spacer()
            Menu {
                Picker("Translation", selection: $translationRaw) {
                    ForEach(Translation.allCases) { Text($0.title).tag($0.rawValue) }
                }
            } label: {
                Text(translation.short).font(.subheadline.weight(.semibold))
            }
            Menu {
                Button("Larger text", systemImage: "plus") { fontSize = min(fontSize + 2, 32) }
                Button("Smaller text", systemImage: "minus") { fontSize = max(fontSize - 2, 13) }
            } label: {
                Image(systemName: "textformat.size")
            }
            .padding(.leading, 12)
        }
        .foregroundStyle(Color(ink))
    }

    private func footer(spread: Bool) -> some View {
        HStack {
            Button { turn(-1, spread: spread) } label: { Image(systemName: "chevron.left") }
            Spacer()
            Text(pages.isEmpty ? "" : "Page \(first + 1)\(spread && first + 1 < pages.count ? "–\(first + 2)" : "") of \(pages.count)")
                .font(.footnote)
            Spacer()
            Button { turn(1, spread: spread) } label: { Image(systemName: "chevron.right") }
        }
        .foregroundStyle(Color(ink).opacity(0.7))
    }

    @ViewBuilder
    private func pageView(_ index: Int, size: CGSize) -> some View {
        if pages.indices.contains(index) {
            PageText(text: pages[index].text)
                .frame(width: size.width, height: size.height, alignment: .topLeading)
        } else {
            Color.clear.frame(width: size.width, height: size.height)
        }
    }

    // MARK: Paging

    private func repaginate(size: CGSize, spread: Bool) async {
        guard let book else { return }
        let ink = self.ink, accent = self.accent
        let points = CGFloat(fontSize)
        let result = await Task.detached(priority: .userInitiated) {
            Paginator.pages(for: book, size: size, fontSize: points, ink: ink, accent: accent)
        }.value
        pages = result
        snap(to: chapter, spread: spread)
    }

    /// Shows the first page of a chapter (a spread always starts on a left page).
    private func snap(to chapter: Int, spread: Bool) {
        let target = pages.firstIndex { $0.chapter == chapter } ?? 0
        first = spread ? target - target % 2 : target
    }

    private func turn(_ direction: Int, spread: Bool) {
        let next = first + direction * (spread ? 2 : 1)
        if pages.indices.contains(next) {
            forward = direction > 0
            withAnimation(.easeInOut(duration: 0.3)) { first = next }
            chapter = pages[next].chapter
        } else if direction > 0, bookIndex + 1 < books.count {
            chapter = 1
            bookIndex += 1
        } else if direction < 0, bookIndex > 0 {
            chapter = books[bookIndex - 1].chapters.count
            bookIndex -= 1
        }
    }
}
