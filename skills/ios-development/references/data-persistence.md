# Data and Persistence

## Choosing the Store

| Need | Use |
|---|---|
| Model graph, queries, new app (iOS 17+) | **SwiftData** |
| Model graph, pre-17 targets or existing stack | **Core Data** |
| Secrets: tokens, credentials | **Keychain** — never UserDefaults |
| Small preferences/flags | UserDefaults (`@AppStorage`) |
| Cross-device sync | CloudKit (via SwiftData/Core Data mirroring) |
| Files/documents | FileManager in proper containers |

Match the repo: don't migrate Core Data→SwiftData (or to Realm, which
some codebases use) as a side effect of a feature.

## SwiftData (iOS 17+)

```swift
@Model
final class Topic {
    @Attribute(.unique) var id: String
    var name: String
    var createdAt: Date
    @Relationship(deleteRule: .cascade) var notes: [Note] = []

    init(id: String, name: String, createdAt: Date = .now) {
        self.id = id; self.name = name; self.createdAt = createdAt
    }
}

// App entry: .modelContainer(for: Topic.self)

struct TopicList: View {
    @Query(sort: \Topic.createdAt, order: .reverse) private var topics: [Topic]
    @Environment(\.modelContext) private var context

    func add(_ name: String) {
        context.insert(Topic(id: UUID().uuidString, name: name))
    }
}
```

Schema changes need a versioned migration plan (`VersionedSchema` +
`SchemaMigrationPlan`) once shipped — additive changes are lightweight,
renames/transforms are explicit stages.

## Core Data

- Stack: `NSPersistentContainer` (or `NSPersistentCloudKitContainer` for
  sync); `viewContext` for UI reads, `newBackgroundContext()` for writes;
  `automaticallyMergesChangesFromParent = true`.
- SwiftUI reads via `@FetchRequest`; repositories wrap contexts so view
  models never see `NSManagedObject` directly — map to value-type models
  at the boundary (same entity↔domain mapping discipline as other
  stacks).
- **Never block the main thread with fetches/saves** — background
  contexts with `perform`.
- Migrations: lightweight migration covers additive changes; test any
  mapping-model migration against a copy of a real store. Shipping a
  model change without a migration story corrupts user data.

## Keychain and Biometrics

- Secrets via Keychain Services (`kSecClassGenericPassword`), or a thin
  wrapper; choose accessibility deliberately
  (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` for non-synced
  secrets).
- Biometric gates: `LAContext.evaluatePolicy(.deviceOwnerAuthentication…)`
  **with a passcode fallback path**; never store the secret itself
  outside Keychain because Face ID "protects" the screen.
- UserDefaults is plaintext — preferences only, never tokens/PII.

## CloudKit Sync Notes

`NSPersistentCloudKitContainer`/SwiftData-CloudKit gives offline-first
sync with the local store as truth — same shape as other stacks. Design
for conflicts (last-writer-wins fields vs merge logic), test airplane
mode → edit → reconnect, and remember schema changes must be promoted in
the CloudKit dashboard before release.

## Networking Layer

```swift
protocol UserAPI {                       // protocol seam for testing
    func user(id: Int) async throws -> User
}

struct LiveUserAPI: UserAPI {
    let session: URLSession = .shared
    let decoder = JSONDecoder()

    func user(id: Int) async throws -> User {
        let (data, response) = try await session.data(from: Endpoint.user(id).url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NetworkError.serverError(statusCode: (response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try decoder.decode(User.self, from: data)
    }
}
```

`Codable` models mirroring the wire format, mapped to domain models at
the repository; typed `NetworkError`; ATS stays on (HTTPS) — exceptions
are red flags in review; reachability informs UX, never gates requests.

## Offline-First Shape

Repository owns: read from store (reactive — `@Query`/`@FetchRequest`/
publisher), sync network → store, expose domain models. UI observes the
store only. Background refresh via `BGAppRefreshTask` where the product
needs it — scheduled, budget-respecting, idempotent.
