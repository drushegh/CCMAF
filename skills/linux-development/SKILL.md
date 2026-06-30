---
name: linux-development
description: >-
  Linux as a development and workstation environment, plus the shared Linux
  foundations every other Linux task builds on: the filesystem hierarchy and
  everything-is-a-file model, processes and signals, users/permissions,
  package management, the shell environment and dotfiles, desktop basics, and
  WSL2 on Windows in depth. Use whenever working on or in a Linux machine —
  setting up a dev environment, understanding paths/permissions/processes,
  installing software, configuring a shell, or running Linux via WSL2.
  Triggers include "Linux", "Ubuntu/Debian/Fedora/Arch", "WSL"/"WSL2",
  ".bashrc"/".zshrc"/dotfiles, "chmod/chown", "apt/dnf/pacman", "$PATH". This
  skill OWNS the Linux foundations; server operations route to
  linux-administration.
---

# Linux Development

Linux as a **workstation and development environment**, and the **shared
foundations** the rest of the Linux skills assume. For Damien's Windows-first
estate, the most common entry point is **WSL2** — treated here as a first-class
environment. Server operations (systemd services at depth, networking/firewall,
hardening, monitoring) live in `linux-administration`, which builds on the
foundations defined here.

Context (June 2026 — re-verify): mainstream distros are Ubuntu/Debian (`apt`),
Fedora/RHEL (`dnf`), Arch (`pacman`). WSL2 supports **systemd** (opt-in via
`wsl.conf`) and a **mirrored networking** mode (Windows 11 22H2+); mirrored mode
improves VPN/DNS but has had Docker Desktop conflicts — verify before relying on
it.

## Non-negotiables

1. **Understand the model before the command.** Linux is *everything-is-a-file*,
   a single rooted tree (FHS), processes with users/permissions, and the shell
   as the interface. Know *why* a command works; don't paste commands you can't
   explain — especially as root.
2. **Least privilege, deliberate `sudo`.** Run as a normal user; `sudo`
   specific commands, never "just run everything as root". Read a command before
   elevating it.
3. **Never pipe untrusted scripts into a root shell.** `curl … | sudo bash` is a
   supply-chain risk — prefer the distro package manager or a verified,
   inspected installer; check signatures.
4. **Config is version-controlled.** Dotfiles (`.bashrc`, `.config/…`) and
   environment setup belong in a tracked, reproducible repo, not hand-edited and
   forgotten.
5. **Package manager first.** Install via `apt`/`dnf`/`pacman` (or a vetted
   source) so software is tracked, updatable and removable; avoid stray
   `make install` into system paths.
6. **Respect `$PATH` and shell-init order.** Know login vs interactive shells
   and which file runs when — most "works in one terminal, not the other" bugs
   live here.
7. **Quote and tread carefully with destructive commands.** Paths with spaces,
   globs, and `rm -rf` demand care; for scripting discipline →
   `bash-development`.

## Decision tables

| Distro family | Manager | You'll meet it as |
|---|---|---|
| Debian/Ubuntu | `apt` (`.deb`) | The default for servers, WSL, most cloud images |
| Fedora/RHEL/Alma/Rocky | `dnf` (`.rpm`) | Enterprise/RHEL estates, Azure RHEL |
| Arch | `pacman` | Rolling-release workstations |
| (cross-distro apps) | Flatpak / Snap | Desktop GUI apps sandboxed |

| Want Linux on Windows for... | Use |
|---|---|
| Dev environment, CLI, containers, daily Linux work | **WSL2** (fast, integrated, the default) |
| Full isolation / GUI desktop / kernel-level work | A **VM** (Hyper-V/VirtualBox) |
| Bare-metal performance / dedicated machine | Dual-boot or a dedicated box |
| Just running a Linux service | A **container** → `containers-development` |

## High-frequency pitfalls

- **`curl | sudo bash`** installs — unverified, untracked, root. Use packages.
- **Permission/ownership confusion** — editing a root-owned file as your user,
  or `chmod 777` to "fix" access (it's a security hole, not a fix).
- **`$PATH`/shell-init surprises** — a tool found in one shell, not another;
  know `.bashrc` (interactive) vs `.profile`/`.bash_profile` (login).
- **CRLF line endings** on scripts edited from Windows → `\r` errors;
  `bad interpreter`. Set the editor/Git to LF (relevant to WSL).
- **WSL filesystem performance** — working under `/mnt/c/...` (Windows fs) is
  slow; keep dev work in the Linux fs (`~`). And don't edit Linux files from
  Windows tools via `\\wsl$` carelessly.
- **Treating Linux like Windows** — case-sensitive paths, no drive letters,
  `/` not `\`, permissions matter.
- **Forgetting `wsl --shutdown`** after changing `.wslconfig`/`wsl.conf` — the
  change won't apply until restart.

## Workflow (set up / work in a Linux environment)

1. Pick the environment (table above); for Windows, install WSL2 (`wsl
   --install`) and a distro.
2. Configure the shell + dotfiles (version-controlled); set sane `$PATH`,
   editor, Git (LF endings).
3. Install tooling via the package manager; isolate language runtimes
   (per-language skills) rather than polluting system Python/Node.
4. Understand permissions/ownership for the files you touch; use `sudo`
   surgically.
5. Troubleshoot from the model (`local-troubleshooting.md`): what process,
   which file, whose permission, which path.

## Reference index

Load on demand:

- `references/foundations.md` — FHS, everything-is-a-file, processes/signals, the permission model
- `references/shell-environment.md` — login vs interactive shells, $PATH, env, dotfiles
- `references/packages-software.md` — apt/dnf/pacman, repos, Flatpak/Snap, building from source
- `references/workstation-desktop.md` — desktop environments, dev tooling, fonts/clipboard, daily-driver setup
- `references/wsl2.md` — WSL2 on Windows: install, wsl.conf/.wslconfig, systemd, networking, interop, filesystem
- `references/local-troubleshooting.md` — diagnosing the local machine from the model

## Boundaries

- **Shell *scripting*** (writing robust `.sh`, strict mode, BATS) →
  `bash-development`. This skill is the OS/environment; that one is the
  scripting language.
- **Server operations** — systemd service management at depth, networking/
  firewall, users/PAM at admin scale, hardening/CIS, performance and monitoring,
  automation → `linux-administration` (it assumes these foundations).
- **Linux inside containers** (minimal userland, base images) →
  `containers-development`; **provisioning Linux VMs on Azure** →
  `azure-development`.
- **Per-language runtime/dev setup** (Python venvs, Node, .NET on Linux) → the
  language skill.
