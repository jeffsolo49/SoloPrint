import SwiftUI

struct PickerView: View {
    let books: [Book]
    let onSelect: (Int, Int) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Old Testament") {
                    ForEach(0..<min(Bible.oldTestamentCount, books.count), id: \.self) { row($0) }
                }
                if books.count > Bible.oldTestamentCount {
                    Section("New Testament") {
                        ForEach(Bible.oldTestamentCount..<books.count, id: \.self) { row($0) }
                    }
                }
            }
            .navigationTitle("Books")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .navigationDestination(for: Int.self) { chapters($0) }
        }
    }

    private func row(_ index: Int) -> some View {
        NavigationLink(books[index].name, value: index)
    }

    private func chapters(_ index: Int) -> some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 56))], spacing: 10) {
                ForEach(1...max(1, books[index].chapters.count), id: \.self) { number in
                    Button("\(number)") {
                        onSelect(index, number)
                        dismiss()
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding()
        }
        .navigationTitle(books[index].name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
