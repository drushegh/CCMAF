# Modularization and Gradle

## Module Map

```
app/                     # navigation host, scaffolding, DI wiring — thin
feature/
  └── myfeature/
      ├── api/           # navigation routes only (public surface)
      └── impl/          # Screen, ViewModel, DI — everything internal
core/
  ├── model/             # pure Kotlin domain models (no Android deps)
  ├── data/              # repositories
  ├── database/          # Room: DAOs, entities, database
  ├── network/           # Retrofit, network models
  ├── datastore/         # preferences
  ├── designsystem/      # theme, icons, base components
  ├── ui/                # shared feature-agnostic composables
  ├── common/            # utilities, dispatchers
  └── testing/           # test doubles, rules, fixtures
build-logic/convention/  # convention plugins
gradle/libs.versions.toml
```

Dependency rules: features depend on core, never on other features
(cross-feature navigation goes through `api` modules); `core:model` has
no Android dependencies; `app` glues everything. The `api`/`impl` split
keeps build graphs shallow — consumers compile against tiny `api`
modules.

## Version Catalog (`gradle/libs.versions.toml`)

```toml
[versions]
compileSdk = "34"
minSdk = "24"
kotlin = "1.9.22"            # match the repo — never bump as a side effect
androidxComposeBom = "2024.02.00"
hilt = "2.50"
room = "2.6.1"
ksp = "1.9.22-1.0.17"

[libraries]
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "androidxComposeBom" }
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
turbine = { group = "app.cash.turbine", name = "turbine", version = "1.0.0" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
```

All dependencies through the catalog — no inline version strings in
module build files. Compose versions via the BOM. KSP (not kapt) for
Room/Hilt processors in current setups.

## Convention Plugins (`build-logic/`)

One plugin per module archetype so configuration lives in exactly one
place:

| Plugin | Applies to |
|---|---|
| `x.android.application` | app module: SDK levels, build types |
| `x.android.library` | core libraries |
| `x.android.feature` | feature modules: library + hilt + compose + common deps |
| `x.android.library.compose` | Compose toggles + BOM wiring |
| `x.hilt` | Hilt + KSP processor |

```kotlin
// build-logic/convention/build.gradle.kts
plugins { `kotlin-dsl` }

dependencies {
    compileOnly(libs.android.gradlePlugin)
    compileOnly(libs.kotlin.gradlePlugin)
    compileOnly(libs.ksp.gradlePlugin)
}
```

A feature module's build file then collapses to:

```kotlin
plugins {
    alias(libs.plugins.myapp.android.feature)
}

android { namespace = "com.example.feature.topic.impl" }

dependencies {
    implementation(projects.feature.topic.api)
    implementation(projects.core.data)
}
```

## Build Hygiene

- `JavaVersion.VERSION_17` toolchain; Kotlin DSL everywhere.
- Type-safe project accessors (`projects.core.data`) over string paths.
- Build variants/flavours defined once in convention plugins; tests run
  per variant (`testDemoDebug`-style names in flavoured repos).
- R8/ProGuard: keep rules live with the code that needs them (consumer
  rules in library modules); verify release builds when touching
  serialisation or reflection.
- New module checklist: catalog entries only, convention plugin applied,
  namespace set, added to `settings.gradle.kts`, minimal deps.
