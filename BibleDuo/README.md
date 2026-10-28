# Bible Duo

A Bible reader for the foldable iPhone. Folded, it shows one page. Unfolded, it shows two pages side by side
with a crease down the middle, like an open book. Swipe or tap the arrows to turn pages.

- Text: King James Version and Bible in Basic English (both public domain, stored in the app, works offline).
- Pages are measured with the same text engine that draws them, so a chapter always fills the page and nothing is cut off.
- Remembers your book, chapter, translation and text size. Light and dark mode.

## Run it (needs a Mac with Xcode)

1. `brew install xcodegen`
2. In this folder: `xcodegen` (creates `BibleDuo.xcodeproj` from `project.yml`)
3. Open `BibleDuo.xcodeproj`, pick the iPad or iPhone simulator (a wide simulator shows the two-page spread), press Run.
4. To put it on your phone: Xcode → the target's Signing settings → pick your Apple ID team.

Not yet compiled or tested: this was written in a Linux cloud session with no Swift compiler.
