# Workstation and desktop

Using Linux as a daily-driver / development machine. (For Windows users, most
of this also applies inside WSL2 minus the GUI — see `wsl2.md`.)

## Desktop environments and the display server

- **Desktop environments**: GNOME (default on Ubuntu/Fedora) and KDE Plasma are
  the mainstream; XFCE/others are lighter. They bundle the shell, window
  manager, file manager and settings.
- **Display server**: **Wayland** is now the default on most modern distros; X11
  is the legacy fallback. Most apps work on Wayland, but some
  (older/screen-sharing/automation tools) still assume X11 — if something
  misbehaves with input, screenshots or remote control, the Wayland/X11 split is
  a prime suspect. Log in to an "X11" session to test.

## Development tooling

- **Editor/IDE**: VS Code (with the Remote-WSL / Remote-SSH extensions for
  WSL/servers), JetBrains, or terminal editors (vim/neovim). On WSL, run the
  editor on Windows and open the Linux workspace remotely — don't edit Linux
  files through `\\wsl$` with a Windows-native editor.
- **Terminal**: a good terminal + multiplexer (`tmux`) for persistent sessions.
- **Git**: configure identity and **LF line endings**
  (`git config --global core.autocrlf input` on WSL/Linux) to avoid CRLF
  breakage on shell scripts.
- **Runtimes**: install language runtimes via version managers / the language's
  own tooling (pyenv/uv, nvm/fnm, rustup, dotnet) into your user space, not
  system-wide — keeps projects isolated and reproducible (→ language skills).

## Fonts, clipboard, and quality-of-life

- Install a programming font with ligatures/Nerd-Font glyphs if your terminal
  theme expects them.
- Clipboard: `xclip`/`wl-copy` (X11/Wayland); on WSL, `clip.exe` bridges to
  Windows. GUI copy/paste "just works"; CLI needs these helpers.
- `~/.local/bin` on `$PATH` for user-installed tools (see
  `shell-environment.md`).

## Reproducible setup

Treat your machine setup as code: a **dotfiles repo** plus a short bootstrap
script (or `chezmoi`/`stow`) that installs your packages and links your config.
A new laptop, a reinstalled distro, or a fresh WSL distribution should be
productive in minutes, not a day of manual fiddling. Keep secrets out of the
dotfiles repo.

## Where the desktop ends

This is the workstation surface. **Server-side concerns** — running services
(systemd units), firewalling, remote access hardening, monitoring — are
`linux-administration`. **Containers** for running services locally →
`containers-development`.
