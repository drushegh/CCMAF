# SwiftUI Patterns

## Component Selection (HIG-aligned)

| Purpose | SwiftUI | UIKit equivalent |
|---|---|---|
| Top-level sections | `TabView` + `tabItem` | `UITabBarController` |
| Drill-down | `NavigationStack` + `NavigationPath` | `UINavigationController` |
| Focused task | `.sheet` + `presentationDetents` | sheet presentation |
| Critical choice | `.alert` | `UIAlertController` |
| Secondary actions | `.contextMenu` | `UIContextMenuInteraction` |
| Lists | `List` (`.insetGrouped`) | `UICollectionView` + diffable |
| Search | `.searchable` | `UISearchController` |
| Share | `ShareLink` | `UIActivityViewController` |
| Known progress | `ProgressView(value:total:)` | `UIProgressView` |
| Haptics | `UIImpactFeedbackGenerator` | same |

## State Management

```swift
@MainActor
final class ProfileViewModel: ObservableObject {
    @Published private(set) var state: ViewState = .loading
    // setter private — views send events, never mutate state
    func onAppear() async { /* load → state = .loaded(data) */ }
}

struct ProfileView: View {
    @StateObject private var viewModel = ProfileViewModel()   // view OWNS it
    var body: some View {
        content.task { await viewModel.onAppear() }
    }
}
```

- `@State` — view-local value state; `@Binding` — pass write access down.
- `@StateObject` — the owner of an ObservableObject;
  `@ObservedObject` — passed-in, owned elsewhere. Getting these backwards
  causes state resets on re-render.
- On `@Observable`-macro codebases (iOS 17+), plain `let viewModel` +
  `@State` ownership replaces the property wrappers — match the repo.
- Model screen state as an enum (`loading / loaded(T) / error(String)`),
  switch in the body — same illegal-states discipline as every stack.

## Navigation

```swift
// Programmatic, type-safe stack
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    RootView()
        .navigationDestination(for: Topic.self) { topic in
            TopicDetail(topic: topic)
        }
        .navigationTitle("Topics")            // large titles on primary views
}
// push: path.append(topic) — pop: path.removeLast()
```

`TabView` owns top-level sections; each tab gets its own
`NavigationStack`; state survives tab switches (`@SceneStorage` for
restoration). Never break the edge back-swipe.

## Lists

```swift
List {
    Section("Favourites") {
        ForEach(favourites) { item in          // Identifiable — never indices
            ItemRow(item: item)
        }
        .onDelete(perform: delete)
    }
}
.listStyle(.insetGrouped)
.searchable(text: $query)
.refreshable { await viewModel.refresh() }
```

Rows ≥ 44pt; stable identity (`Identifiable`); heavy rows get extracted
subviews; `task(id:)` for per-item async work that cancels on disappear.

## Sheets and Presentation

```swift
.sheet(isPresented: $showingEditor) {
    EditorView()
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
}
```

Every sheet has an explicit dismiss path (button and/or drag); use
`.confirmationDialog` for destructive choices, `.alert` only for critical
decisions.

## Async Content

```swift
// Lifecycle-tied loading — cancels automatically when the view disappears
.task { await viewModel.load() }
.task(id: query) { await viewModel.search(query) }   // re-runs per value

AsyncImage(url: item.imageURL) { image in
    image.resizable().aspectRatio(contentMode: .fill)
} placeholder: {
    Color(.secondarySystemBackground)        // skeleton, not a spinner per cell
}
```

## Previews

```swift
#Preview("Loaded") {
    ProfileView(state: .loaded(.fixture))
}
#Preview("Dark, large text") {
    ProfileView(state: .loaded(.fixture))
        .preferredColorScheme(.dark)
        .environment(\.dynamicTypeSize, .accessibility3)
}
```

Previews per UiState variant + dark mode + an accessibility text size —
they're the cheapest regression net and double as documentation. Keep
views previewable: state in, events out, no singleton access in bodies.

## UIKit Interop

`UIViewRepresentable`/`UIViewControllerRepresentable` to wrap UIKit in
SwiftUI; `UIHostingController` to embed SwiftUI in UIKit. Reach for UIKit
when SwiftUI genuinely lacks the control (advanced collection layouts via
`UICollectionViewCompositionalLayout` + diffable data sources, complex
text interaction) — not from habit. Keep the boundary thin and typed
(coordinator handles delegates).

## Performance

Keep `body` cheap: no formatting/sorting/decoding inline — precompute in
the view model. Extract subviews so invalidation scopes shrink. Stable
identity everywhere. Animate properties, not layout storms
(`withAnimation`, `matchedGeometryEffect` deliberately). Respect
`accessibilityReduceMotion` for decorative animation.
