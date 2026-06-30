# WSL2 (Linux on Windows)

For a Windows-first estate, WSL2 is the primary way to run Linux: a real Linux
kernel in a lightweight VM, integrated with Windows. Treat it as a first-class
Linux environment. (Facts June 2026 — re-verify; WSL evolves.)

## Install and manage

```powershell
wsl --install                 # installs WSL2 + default Ubuntu (Windows 11/10)
wsl --list --online           # available distros
wsl --install -d Ubuntu-24.04
wsl --set-default-version 2
wsl --update                  # update the WSL kernel/components
wsl --shutdown                # stop all distros (needed to apply config changes)
```

Distros are managed from PowerShell; inside, it's a normal Linux shell.

## Two config files — know which is which

- **`.wslconfig`** (Windows side, `%UserProfile%\.wslconfig`) — global WSL2 VM
  settings: memory, processors, **networkingMode**, swap.
- **`wsl.conf`** (inside the distro, `/etc/wsl.conf`) — per-distro settings:
  **systemd**, default user, mounts, hostname.

Both require **`wsl --shutdown`** to take effect.

```ini
# /etc/wsl.conf  (inside the distro)
[boot]
systemd=true
[automount]
options = "metadata,umask=22,fmask=11"
```

```ini
# %UserProfile%\.wslconfig  (Windows)
[wsl2]
memory=8GB
processors=4
networkingMode=mirrored
```

Enabling **systemd** (`[boot] systemd=true`) makes `systemctl` work — important
for services and many dev tools (see `linux-administration` for systemd depth).

## Networking

- Default is NAT (the distro gets its own subnet). **Mirrored** mode (Windows 11
  22H2+) mirrors the Windows interfaces into Linux and markedly improves
  VPN/DNS/localhost behaviour — but has had **conflicts with Docker Desktop**;
  test before committing to it.
- `localhost` forwarding lets Windows reach a service bound in WSL (and often
  vice-versa). For corporate VPN/proxy/DNS pain, mirrored mode is usually the
  fix to try first.

## Filesystem — performance matters

- Keep dev work in the **Linux filesystem** (`~`, i.e. `/home/...`); it's fast.
  Files under **`/mnt/c/...`** (the Windows drive) cross the VM boundary and are
  **slow** for IO-heavy work (node_modules, git on large repos, builds).
- Access Linux files from Windows via `\\wsl$\<distro>\...` or
  `explorer.exe .` — but edit them with WSL-aware tools (VS Code Remote-WSL),
  not Windows-native editors that mangle permissions/line endings.
- **Line endings**: set Git to LF (`core.autocrlf input`) so scripts created on
  Windows don't get `\r` and fail with "bad interpreter".

## Interop and GPU

- Run Windows executables from Linux (`explorer.exe`, `code .`, `clip.exe`) and
  vice-versa; `$PATH` includes Windows by default (toggleable in `wsl.conf`).
- **WSLg** provides Linux GUI apps and audio out of the box.
- **GPU compute** (CUDA/DirectML) is available for ML workloads.

## Common gotchas

- Changed `.wslconfig`/`wsl.conf` but "nothing happened" → you didn't
  `wsl --shutdown`.
- Slow git/npm → you're working under `/mnt/c`; move into `~`.
- `systemctl` says "not booted with systemd" → enable it in `wsl.conf` and
  restart.
- Clock drift after sleep → resolved on recent WSL; `sudo hwclock -s` if needed.
