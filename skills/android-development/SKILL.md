---
name: android-development
description: >-
  Native Android development with Kotlin and Jetpack Compose following
  Google's official architecture guidance (NowInAndroid patterns): MVVM
  with unidirectional data flow, offline-first data layers, Hilt DI, Room,
  modularization, and testing, with detailed topic references loaded on
  demand. Use this skill whenever Android code is created, edited,
  reviewed, or debugged — even if the user doesn't say "Android". Triggers
  include: .kt files in an Android project, build.gradle.kts /
  libs.versions.toml, Composables/ViewModels/repositories, Hilt or Room
  work, Compose UI or Material 3, app architecture or module structure,
  Gradle build issues, Play Store release preparation.
---

# Android Development

Consolidated native Android engineering for agents, modelled on Google's
architecture guidance as demonstrated in the NowInAndroid reference app.
The rules here always apply; load `references/` files only when the task
touches that topic. React Native is a different stack (parked separately —
don't apply these patterns there).

## Baseline

Kotlin (2.x era) + Jetpack Compose + Material 3, coroutines/Flow
throughout, Hilt for DI, Room for persistence, Gradle with Kotlin DSL +
version catalogs (`libs.versions.toml`) + KSP. Match the repo's existing
versions and conventions — never bump Kotlin/AGP/Compose versions as a
side effect.

## Architecture — non-negotiable shape

```
UI (Compose Screens + ViewModels, StateFlow of UiState)
 ↓ events            ↑ data
Domain (optional use cases — only when logic is shared/complex)
 ↓                   ↑
Data (Repositories → Room DAO local + Retrofit remote)
```

1. **Offline-first**: the local database is the source of truth; network
   syncs into it (WorkManager), UI reads only from local.
2. **Unidirectional data flow**: events down, data up. UI never mutates
   state directly.
3. **Reactive streams everywhere**: repositories expose `Flow of T` — never
   one-shot snapshot getters for observable data.
4. **Repository pattern**: one public interface per data domain;
   implementations `internal`.

Details: [references/architecture.md](references/architecture.md).

## Core UI Patterns (always)

- **UiState as sealed interface** (`Loading / Success(data) / Error`) —
  one per screen; impossible states unrepresentable.
- **ViewModel exposes a single `StateFlow of UiState`** via
  `.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Loading)`
  — never expose `MutableStateFlow`, never collect into mutable fields.
- **Route/Screen split**: `*Route` composable owns the ViewModel +
  navigation callbacks; `*Screen` is pure UI taking state + lambdas —
  testable and previewable without Hilt.
- **`collectAsStateWithLifecycle()`** in composables — plain
  `collectAsState` leaks collection while backgrounded.
- **Stateless components**: state and callbacks as parameters; hoist
  state; `Modifier` as the last defaulted parameter.
- **Type-safe navigation** (`@Serializable` route classes,
  `type-safe composable`, `savedStateHandle.toRoute()`).

Details: [references/compose.md](references/compose.md).

## Tooling

```bash
./gradlew :app:assembleDebug             # build
./gradlew testDebugUnitTest              # JVM unit tests
./gradlew connectedDebugAndroidTest      # instrumented (device/emulator)
./gradlew lint ktlintCheck detekt        # whichever the repo configures
```

Dependencies only via the version catalog; module config via convention
plugins in `build-logic/` for multi-module repos. Details:
[references/modularization-gradle.md](references/modularization-gradle.md).

## Critical Pitfalls — always check

- **`collectAsState` without lifecycle** → `collectAsStateWithLifecycle`.
- **Missing `key` in `LazyColumn.items`** → recomposition chaos and lost
  item state on reorder: `items(items, key = { it.id })`.
- **Business logic in composables** → it belongs in the ViewModel/domain;
  composables render state and forward events.
- **Exposed mutable state** (`MutableStateFlow`/`mutableStateOf` public
  on a ViewModel) → expose read-only types.
- **`GlobalScope`/unscoped coroutines** → `viewModelScope`; work that must
  outlive the screen goes to WorkManager.
- **Room/disk/network on the main thread** → suspend DAOs and
  `Dispatchers.IO` injected, not hardcoded.
- **Hardcoded user-facing strings** → string resources, always.
- **kotlinx.serialization/Retrofit models without R8 keep rules** →
  release-build crashes that debug never shows.
- **Stale Compose state from missing `remember` keys** →
  `remember(input)` / `derivedStateOf` for computed state.

## Agent Workflow Rules

1. **Inspect first**: `libs.versions.toml`, existing module layout,
   convention plugins, one existing feature module as the pattern to
   mirror. New code matches the repo's established shape.
2. **New feature = the standard file set**: Screen, ViewModel, UiState,
   Navigation, DI module — in the right module (`feature:x:impl`), with
   `internal` visibility and an `api` module exposing only navigation.
3. **Testing is test-doubles-first** (NowInAndroid style): fake
   repositories implementing the real interfaces with test hooks — not
   mocking libraries. Every ViewModel gets a state-emission test; every
   DAO an in-memory Room test. Details: [references/testing.md](references/testing.md).
4. **Release-affecting changes** (serialisation, reflection, native libs)
   get verified against a minified release build, not just debug.
5. **Before completion**: assemble + unit tests + lint/ktlint/detekt
   clean; no stray `Log.d` debugging; strings extracted; previews compile.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Layers, repositories, offline-first sync, use cases, model mapping | [references/architecture.md](references/architecture.md) |
| Compose screens, state, navigation, theming, previews, adaptive UI | [references/compose.md](references/compose.md) |
| Room entities/DAOs/migrations, DataStore, Hilt data modules | [references/data-room.md](references/data-room.md) |
| Module structure, version catalogs, convention plugins, build config | [references/modularization-gradle.md](references/modularization-gradle.md) |
| Unit/UI/screenshot tests, test doubles, coroutine/Flow testing | [references/testing.md](references/testing.md) |
