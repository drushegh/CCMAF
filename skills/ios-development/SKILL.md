---
name: ios-development
description: >-
  Native iOS development with Swift and SwiftUI (UIKit interop where
  needed): Swift concurrency and language standards, MVVM architecture,
  Human Interface Guidelines compliance, accessibility, persistence
  (SwiftData/Core Data/Keychain), and App Store distribution, with detailed
  topic references loaded on demand. Use this skill whenever iOS/Apple
  platform code is created, edited, reviewed, or debugged — even if the
  user doesn't say "iOS". Triggers include: .swift files, Xcode projects,
  SwiftUI views or UIKit controllers, Info.plist or entitlements,
  xcodebuild/simulator work, HIG or accessibility review, App Store /
  TestFlight preparation, retain cycles or main-thread issues.
---

# iOS Development

Consolidated native iOS engineering for agents. The rules here always
apply; load `references/` files only when the task touches that topic.
React Native is a different stack (parked separately). Android is the
sibling skill — don't port its idioms here.

## Baseline

Swift (6-era, strict concurrency) + SwiftUI-first with UIKit interop
where it earns its place; Swift Package Manager for dependencies; match
the repo's Xcode version, iOS deployment target, and existing
architecture — never raise the deployment target as a side effect.

## Architecture

MVVM with observable view models, repository abstraction over
persistence/network, dependency injection (initialiser injection by
default), coordinator/NavigationStack-path for navigation. ViewModels are
`@MainActor`; all UI mutation happens on the main actor. Views are thin —
business logic lives in view models and below.

## Swift Standards (always)

- **Optionals**: `guard let` for early exit, `if let` for scoped use,
  `??` for defaults. **Never force-unwrap** (`!`) outside tests/
  programmer-error invariants — and `try!`/`as!` count.
- **Value types first**: structs for models, classes only for identity/
  shared state, enums for finite states. Protocol-oriented over
  inheritance.
- **Typed errors**: `enum` conforming to `Error` (+ `LocalizedError` for
  user-facing messages); exhaustive `do/catch` on specific cases; `try?`
  only when discarding the reason is deliberate.
- **ARC discipline**: `[weak self]` in escaping closures that may outlive
  scope; `unowned` only with a guaranteed lifetime; watch
  delegate/parent-child cycles (`weak var delegate`).
- **Concurrency**: async/await everywhere (no completion-handler new
  code); `async let`/`TaskGroup` for parallel work; `actor` for shared
  mutable state; `Task.checkCancellation()` in loops; `Sendable`
  conformance across concurrency boundaries; never block the main thread.

Details: [references/swift-standards.md](references/swift-standards.md).

## HIG Essentials (always)

- Touch targets ≥ 44pt; content inside safe areas; 8pt spacing grid;
  primary actions in the thumb zone; support SE through Pro Max widths.
- **Semantic everything**: system text styles (`.body`, `.headline`) for
  Dynamic Type; semantic colours (`.primary`, `Color(.systemBackground)`)
  for dark mode; SF Symbols for icons. Custom fonts scale via
  `relativeTo:`; custom colours ship light/dark variants.
- Navigation: `TabView` for 3–5 top-level sections (tab bar stays visible
  while drilling down); `NavigationStack` for hierarchy; **never hamburger
  menus; never override the back-swipe**; state preserved across tabs.
- Contrast ≥ 4.5:1 (3:1 large text); never convey information by colour
  alone; alerts for critical decisions only; sheets always dismissible.

Details: [references/swiftui-patterns.md](references/swiftui-patterns.md)
and [references/hig-accessibility.md](references/hig-accessibility.md).

## Critical Pitfalls — always check

- **Retain cycles** — closures capturing `self` strongly in stored
  handlers; delegate properties not `weak`.
- **UI off the main actor** — `@MainActor` on view models; no
  `DispatchQueue.global` mutations of published state.
- **Blocking main** — sync network/disk/decode on the main thread; use
  async APIs, move CPU work to background tasks.
- **Permissions at launch** — request in context with a custom
  explanation first; respect ATT denial; basic features work without an
  account (App Store review requirement).
- **Missing accessibility labels** on icon-only buttons; decorative
  animations ignoring Reduce Motion.
- **Hardcoded text sizes/colours** — breaks Dynamic Type and dark mode.
- **List performance** — unstable `ForEach` identity (use `Identifiable`
  ids, never array indices for mutable lists).
- **Force-unwrapped resources** that exist in debug but not in release
  bundles/targets.

## Agent Workflow Rules

1. **Inspect first**: project structure (SPM packages, targets),
   deployment target, existing architecture pattern, one representative
   feature as the shape to mirror.
2. **Build/test from the CLI** when no IDE is in the loop:
   `xcodebuild`/`xcrun simctl` (see
   [references/tooling-distribution.md](references/tooling-distribution.md))
   — and treat compiler warnings as defects, especially Swift concurrency
   warnings: they're future data races.
3. **Every screen**: previews compile (light/dark + at least one
   accessibility text size), VoiceOver labels present, rotation/iPad
   sanity where supported.
4. **Persistence changes** follow the migration rules in
   [references/data-persistence.md](references/data-persistence.md) —
   never ship a model change without a migration story.
5. **Release-affecting work** (privacy manifest, ATT, entitlements,
   signing, push) verified against the distribution checklist before
   completion.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Optionals, protocols, ARC, errors, async/await/actors, access control | [references/swift-standards.md](references/swift-standards.md) |
| SwiftUI state, navigation, lists, sheets, previews, UIKit interop | [references/swiftui-patterns.md](references/swiftui-patterns.md) |
| HIG details, Dynamic Type, dark mode, VoiceOver, gestures, permissions UX | [references/hig-accessibility.md](references/hig-accessibility.md) |
| SwiftData/Core Data, CloudKit, Keychain, biometrics, offline-first | [references/data-persistence.md](references/data-persistence.md) |
| xcodebuild/simctl, SPM, testing, Instruments, TestFlight/App Store | [references/tooling-distribution.md](references/tooling-distribution.md) |
