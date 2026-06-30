# Swift Standards

## Optionals

```swift
// guard for early exit — keeps the happy path unindented
func process(user: User?) throws {
    guard let user else { throw ValidationError.emptyField(name: "user") }
    // user is non-optional from here
}

// if let for scoped use; ?? for defaults; chaining for deep access
let name = user?.profile?.displayName ?? "Guest"

// map/flatMap on optionals instead of unwrap-transform-rewrap
let url = urlString.flatMap(URL.init(string:))
```

**Never force-unwrap.** `!`, `try!`, and `as!` are crash sites; the only
acceptable uses are tests and provable programmer-error invariants (with
a comment saying why). `IUO`s (`String!`) only for framework-imposed
late-init (e.g. IBOutlet legacy).

## Naming

Types `PascalCase`; members `camelCase`; booleans read as assertions
(`isEnabled`, `hasChanges`, `canSubmit`); functions read as sentences at
the call site (`insert(_:at:)`, `move(from:to:)`); argument labels make
calls grammatical, `_` when the first argument is obvious.

## Protocol-Oriented Design

```swift
protocol UserFetching {
    func fetchUser(id: Int) async throws -> User
}

extension UserFetching {
    func fetchCurrentUser() async throws -> User {   // default behaviour
        try await fetchUser(id: Session.currentUserID)
    }
}

// Composition over fat protocols
typealias UserStore = UserFetching & UserPersisting
```

Protocols define capabilities; structs/classes implement them; view
models depend on the protocol — that's the DI seam for testing.

## Value vs Reference Types

| Type | Use when |
|---|---|
| `struct` | data models, view state, anything copied safely (default) |
| `class` | identity matters, shared mutable state, framework requires it |
| `enum` | finite states, state machines (with associated values) |

## ARC and Capture Lists

```swift
// Escaping closure that may outlive self
onComplete = { [weak self] in
    self?.processResult()
}

// Capture the value, not the object, when that's all you need
let id = user.id
fetchData { [id] result in log("fetched for \(id)") }

// Delegates are weak
weak var delegate: ScannerDelegate?
```

`weak` when the reference can become nil; `unowned` only when the
referenced object is guaranteed to outlive the closure/property (e.g.
child → parent it can't exist without); strong otherwise. Suspect every
stored closure and delegate for cycles.

## Error Handling

```swift
enum NetworkError: Error {
    case invalidURL
    case noConnection
    case serverError(statusCode: Int)
    case decodingFailed(underlying: Error)
}

enum ValidationError: LocalizedError {
    case emptyField(name: String)
    var errorDescription: String? {
        switch self {
        case .emptyField(let name): return "\(name) cannot be empty"
        }
    }
}

do {
    let user = try await fetchUser(id: 123)
} catch NetworkError.serverError(let code) {
    handleServer(code)
} catch {
    handleUnknown(error)
}
```

`LocalizedError` for anything surfaced to users. `try?` only when the
failure reason is genuinely irrelevant; `rethrows` for combinators.

## Concurrency (Swift 6 strict mode)

```swift
// async/await — no new completion-handler APIs
func fetchUser(id: Int) async throws -> User {
    let (data, _) = try await URLSession.shared.data(from: url(for: id))
    return try JSONDecoder().decode(User.self, from: data)
}

// Parallel: async let for a fixed set, TaskGroup for dynamic fan-out
async let user = fetchUser(id: 1)
async let posts = fetchPosts(userId: 1)
let profile = try await ProfileData(user: user, posts: posts)

func fetchAll(ids: [Int]) async throws -> [User] {
    try await withThrowingTaskGroup(of: User.self) { group in
        for id in ids { group.addTask { try await fetchUser(id: id) } }
        return try await group.reduce(into: []) { $0.append($1) }
    }
}

// Shared mutable state → actor (compiler-enforced isolation)
actor RequestCache {
    private var cache: [URL: Data] = [:]
    func data(for url: URL) -> Data? { cache[url] }
    func store(_ data: Data, for url: URL) { cache[url] = data }
}

// UI state → @MainActor view models
@MainActor
final class ProfileViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var users: [User] = []

    func loadUsers() async {
        isLoading = true
        defer { isLoading = false }
        do { users = try await fetchUsers() } catch { handle(error) }
    }
}

// Long loops cooperate with cancellation
for item in items {
    try Task.checkCancellation()
    await process(item)
}
```

Strict-concurrency warnings are future data races — fix them (Sendable
conformance, actor isolation), don't `@unchecked Sendable` them away
without a documented invariant.

## Access Control

`private` by default; `fileprivate` rarely; `internal` is the implicit
module default; `public`/`open` only on deliberate API surfaces of SPM
packages. Apply the same minimal-visibility discipline as any other
stack.
