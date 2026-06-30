# Tooling, Testing, Distribution

## CLI Workflow (no IDE in the loop)

```bash
# Discover
xcodebuild -list -project MyApp.xcodeproj          # schemes/targets
xcrun simctl list devices available                 # simulators

# Build + test
xcodebuild build -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16' | xcbeautify
xcodebuild test -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:MyAppTests/ProfileViewModelTests

# Simulator control
xcrun simctl boot "iPhone 16"
xcrun simctl install booted ./build/MyApp.app
xcrun simctl launch booted com.example.myapp
xcrun simctl io booted screenshot shot.png
```

Treat warnings as defects — Swift strict-concurrency warnings
especially. SPM for dependencies (`Package.swift` / Xcode package list);
avoid CocoaPods in new projects; pin versions deliberately.

## Testing

| Layer | Tool | Notes |
|---|---|---|
| Unit (view models, logic) | XCTest / Swift Testing (`@Test`) | protocol-seam fakes, async tests are native |
| UI flows | XCUITest | expensive — reserve for critical journeys |
| Visual regression | snapshot testing | pin device/OS for stable renders |
| Performance | XCTest `measure {}` + Instruments | baseline before optimising |

```swift
@MainActor
final class ProfileViewModelTests: XCTestCase {
    func test_load_publishesLoadedState() async {
        let viewModel = ProfileViewModel(api: FakeUserAPI(result: .success(.fixture)))
        await viewModel.loadUsers()
        XCTAssertEqual(viewModel.users.first?.id, User.fixture.id)
    }
}

struct FakeUserAPI: UserAPI {                       // protocol seam, not mocking magic
    var result: Result<User, Error>
    func user(id: Int) async throws -> User { try result.get() }
}
```

Same doctrine as other stacks: fakes implementing the real protocols,
fixtures centralised, async tests via native async support — no sleeps.

## Instruments (profile before optimising)

Time Profiler (CPU/hangs), Allocations + Leaks (memory, cycle
confirmation), SwiftUI instrument (view body counts), Core Data
instrument (fetch storms). The main-thread hang report in Xcode's
organizer is field truth — check it for shipped apps.

## Signing and Capabilities

Automatic signing for development; managed profiles for CI (App Store
Connect API key — never personal accounts in pipelines). Entitlements
change behaviour (push, App Groups, Keychain sharing, CloudKit) — diff
them in review like code. Bundle ID/team consistent across targets and
extensions.

## TestFlight and App Store

```text
Archive → upload (xcodebuild archive + -exportArchive, or Xcode Cloud/fastlane)
→ TestFlight internal (instant) → external (beta review)
→ App Store review
```

Submission checklist:

- [ ] Privacy: nutrition labels accurate; **privacy manifest**
      (`PrivacyInfo.xcprivacy`) covering required-reason APIs and SDKs;
      usage-description strings for every permission touched
- [ ] ATT implemented if any tracking; app fully functional on denial
- [ ] Sign in with Apple present if other social logins are
- [ ] Account deletion path if accounts exist (review requirement)
- [ ] HIG/accessibility floor (hig-accessibility.md checklist)
- [ ] Version/build numbers bumped; release notes; screenshots current
- [ ] Crash-free on the oldest supported OS/device class

App Store Connect: phased release for risk control; ASO basics (title/
subtitle/keywords) belong to the listing, not the binary. fastlane or
Xcode Cloud automate the lane — match whatever the repo uses.

## CI Sketch

macOS runner: checkout → `xcodebuild test` (simulator destination) →
archive on main/tags → upload via App Store Connect API key. Cache SPM;
fail on warnings; keep simulators pinned to a known OS per branch to
avoid flaky drift.
