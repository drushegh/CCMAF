# Project and Repo Setup

## Directory.Build.props vs Directory.Build.targets

Evaluation order decides which to use:

```
Directory.Build.props → SDK .props → YourProject.csproj → SDK .targets → Directory.Build.targets
```

| `.props` (projects can override) | `.targets` (final say) |
|---|---|
| Property defaults, language settings | Custom build targets |
| Assembly/package metadata | Late-bound overrides depending on SDK-set values |
| Analyzer package references | Post-build validation |

**Critical pitfall:** property conditions on `$(TargetFramework)` in
`.props` silently fail for single-targeting projects — the property is
empty during `.props` evaluation. TFM-conditional properties belong in
`.targets`. (ItemGroup/Target conditions are unaffected.)

```xml
<!-- Directory.Build.props — repo-wide defaults -->
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <Company>Contoso</Company>
  </PropertyGroup>
</Project>
```

Don't put in `.props`: project-specific TFMs or PackageReferences, build
logic, or anything reading SDK-defined properties (e.g. `OutputPath` —
that goes in `.targets`).

MSBuild auto-imports only the **first** `Directory.Build.props` found
walking up from the project. Multi-level hierarchies must chain explicitly:

```xml
<Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))" />
```

## Central Package Management (CPM)

One source of truth for package versions — `Directory.Packages.props` at
the repo root:

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.Extensions.Logging" Version="9.0.0" />
    <PackageVersion Include="xunit" Version="2.9.0" />
  </ItemGroup>
  <ItemGroup>
    <!-- Applies to ALL projects — ideal for analyzers -->
    <GlobalPackageReference Include="Microsoft.CodeAnalysis.NetAnalyzers" Version="9.0.0" />
  </ItemGroup>
</Project>
```

Project files then use `<PackageReference Include="xunit" />` with no
`Version` attribute. When converting an existing repo, collect every
version from every `.csproj`, take the highest of each, and strip
`Version` attributes from the projects.

## SDK Pinning

`global.json` pins the SDK for reproducible builds:

```json
{
  "sdk": { "version": "10.0.100", "rollForward": "latestFeature" }
}
```

On SDK 10+ it can also set the test runner
(`"test": { "runner": "Microsoft.Testing.Platform" }` — see testing.md).

## Repo Layout

```
src/        product code, one folder per project
tests/      test projects (Project.Tests naming)
Directory.Build.props
Directory.Packages.props
global.json
.editorconfig          # style rules — enforced by EnforceCodeStyleInBuild
```

Code style lives in `.editorconfig`, enforced at build time via
`EnforceCodeStyleInBuild` + `TreatWarningsAsErrors`, and applied with
`dotnet format`.

## Directory.Build.rsp

Default CLI args for every build under the tree (one per line):

```
/maxcpucount
/warnAsMessage:MSB3277
```

## Secrets

Never in code or committed config. Local dev: `dotnet user-secrets`.
Deployed: environment variables or a vault (Azure Key Vault via
`AddAzureKeyVault`). Configuration binding with validated options classes
(`builder.Services.AddOptions<T>().BindConfiguration("Section")
.ValidateDataAnnotations().ValidateOnStart()`) so bad config fails at
startup, not mid-request.
