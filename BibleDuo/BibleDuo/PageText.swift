import SwiftUI
import UIKit

/// One printed page of text. A UITextView with no padding lays text out the
/// same way the paginator measured it.
struct PageText: UIViewRepresentable {
    let text: NSAttributedString

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isUserInteractionEnabled = false
        view.isSelectable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        view.attributedText = text
    }
}
