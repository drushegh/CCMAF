# Build Pipeline and CI

## Build Profiles (Unity 6)

Build Profiles (successor to the old Build Settings flow) hold
per-target configuration: platform, scene list overrides, scripting
defines, player settings overrides — multiple profiles per platform
(Dev, Release, Demo). Pin them in version control; CI selects by
profile.

## Scripting backend and stripping

- **IL2CPP** for release on most platforms (required iOS/WebGL/
  consoles): AOT C++ transpile — faster, but no runtime codegen
  (reflection.Emit dead) and managed code **stripping** removes
  "unused" code: reflection-only-used types vanish → preserve via
  `link.xml` or `[Preserve]`. Test IL2CPP builds EARLY, not at ship.
- Mono for fast iteration/dev builds. (CoreCLR transition is
  roadmapped — re-verify this whole area as Unity 6.7/6.8 land.)
- Code stripping level (Minimal→High) trades size vs risk; High +
  reflection-heavy plugins = link.xml maintenance.

## Platform notes (verify per release)

- **Windows/macOS/Linux**: straightforward; notarisation/signing on
  macOS.
- **Android**: keystore management (CI secrets), App Bundle (AAB),
  texture compression (ASTC), Gradle template overrides when plugins
  demand.
- **iOS**: Unity exports an Xcode project — sign/archive on a Mac
  runner; bitcode gone; privacy manifests current requirement —
  check store policy currency.
- **WebGL/Web**: compression (Brotli) + server headers; memory
  limits; no threads without cross-origin isolation; mobile-web
  support improved in Unity 6 — verify target browser matrix.
- Addressables: separate content build
  (`AddressableAssetSettings.BuildPlayerContent()`) BEFORE the
  player build; remote catalogs for content updates.

## CI (batchmode)

```bash
# License activation varies (Personal/Pro/build-server licensing) — see docs
unity-editor \
  -batchmode -nographics -quit \
  -projectPath "$PROJECT_DIR" \
  -executeMethod BuildScripts.BuildRelease \
  -logFile build.log

# Tests
unity-editor -batchmode -nographics \
  -projectPath "$PROJECT_DIR" \
  -runTests -testPlatform EditMode \
  -testResults results-editmode.xml -logFile -
```

```csharp
// Assets/Editor/BuildScripts.cs
using UnityEditor;
using UnityEditor.Build.Profile;

public static class BuildScripts
{
    public static void BuildRelease()
    {
        var profile = AssetDatabase.LoadAssetAtPath<BuildProfile>(
            "Assets/Settings/Build/Win64-Release.asset");
        var options = new BuildPlayerWithProfileOptions
        {
            buildProfile = profile,
            locationPathName = "Builds/Win64/Game.exe",
        };
        var report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
            EditorApplication.Exit(1);
    }
}
```

CI realities: **Library/ caching** is the difference between
10-minute and 2-hour builds (cache per branch+platform); pin editor
version exactly (ProjectVersion.txt drives unity-builder-style
actions); licensing for headless runners (Unity Build Server
licences / personal activation flow) sorted before pipeline design;
runner OS per target (Mac for iOS). Hosting/orchestration →
`devops-development`.

## Profiling and release QA

Profiler (CPU/GPU/memory) attached to a DEVELOPMENT BUILD on target
hardware — editor numbers lie; Profile Analyzer for comparisons;
Memory Profiler for leaks (snapshot diffs around scene loads);
Frame Debugger for draw-call archaeology. Pre-ship sweep: IL2CPP
build smoke test per platform, Addressables content correctness,
asset import audit (texture sizes per platform), build size report
review (Editor.log build report — find the accidental 300 MB
texture).
