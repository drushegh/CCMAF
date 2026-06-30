# .NET on containers

The house stack. Microsoft publishes official images under
`mcr.microsoft.com/dotnet/`. App-code and EF concerns belong to
`dotnet-development`; this covers the *image*.

Repositories: `sdk` (build), `aspnet` (web/runtime + ASP.NET shared
framework), `runtime` (non-web runtime), `runtime-deps` (native deps only —
base for self-contained / AOT). Verify current tags against the
[dotnet-docker](https://github.com/dotnet/dotnet-docker) READMEs.

## Base image / distro choice (June 2026)

.NET 10 is GA. **.NET 10 dropped Debian images** — don't carry forward
`bookworm-slim` tags from a .NET 8/9 Dockerfile. Pick an explicit distro
rather than relying on the bare `10.0` default (re-verify the default
mapping):

| Variant | Example tag | Notes |
|---|---|---|
| Ubuntu Noble (24.04) | `10.0-noble` | General-purpose default |
| Alpine | `10.0-alpine` | Smallest non-distroless; musl — test native deps |
| Azure Linux 3.0 | `10.0-azurelinux3.0` | Microsoft's distro, Azure-optimised |
| Ubuntu chiselled | `10.0-noble-chiseled` | Distroless-style, non-root, no shell |
| Distroless (runtime-deps) | `10.0-noble-chiseled`, `10.0-azurelinux3.0-distroless` | For self-contained/AOT |

Note distro generations differ by .NET version: .NET 8 chiselled is Jammy
(22.04, `8.0-jammy-chiseled`); .NET 9/10 are Noble (24.04). Match the tag to
the framework.

## Non-root and ports

.NET 8+ images define `$APP_UID` (a non-root UID) and default the HTTP port to
**8080** (`ASPNETCORE_HTTP_PORTS=8080`) — not 80. Set `USER $APP_UID`; the
chiselled/extra variants already run non-root. Don't re-enable port 80 or run
as root to "make it work".

## Canonical multi-stage Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
# Restore first for layer caching
COPY ["MyApp/MyApp.csproj", "MyApp/"]
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore "MyApp/MyApp.csproj"
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet publish "MyApp/MyApp.csproj" -c $BUILD_CONFIGURATION \
    -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled AS final
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production
COPY --from=build /app/publish .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "MyApp.dll"]
```

`UseAppHost=false` skips the native launcher when you invoke via
`dotnet MyApp.dll`. For private NuGet feeds, mount the credentials as a
BuildKit secret — never an `ARG` token.

## Native AOT and self-contained

For minimal images and fast cold start (good for Container Apps scale-to-zero),
publish self-contained or **Native AOT**:

- AOT build stage needs the toolchain: `clang`, `zlib1g-dev` (install in the
  SDK stage), then `dotnet publish -r linux-x64 /p:PublishAot=true`.
- Final stage uses `runtime-deps` (no .NET runtime needed) — chiselled or
  distroless. The result is a small, shell-less, non-root image.
- AOT has trim/reflection constraints; confirm the app and its libraries are
  AOT-compatible before committing to it.

## SDK container build (no Dockerfile)

The .NET SDK can build an OCI image directly:

```bash
dotnet publish -c Release /t:PublishContainer \
  -p:ContainerBaseImage=mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled \
  -p:ContainerRegistry=myregistry.azurecr.io
```

Useful for simple services (handles non-root, layering and labels), but a
Dockerfile gives more control for custom native deps, multi-arch nuance or
non-trivial build steps. Choose deliberately; don't maintain both.
