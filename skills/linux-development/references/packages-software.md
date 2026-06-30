# Packages and software

Install through the **package manager** so software is tracked, updatable,
removable and (usually) signature-verified. Stray `make install` and
`curl | bash` leave untracked files you can't cleanly update or remove.

## The big three

```bash
# Debian/Ubuntu (apt, .deb)
sudo apt update && sudo apt upgrade
sudo apt install ripgrep
sudo apt remove ripgrep && sudo apt autoremove
apt-cache search <term>; apt show <pkg>

# Fedora/RHEL/Alma/Rocky (dnf, .rpm)
sudo dnf install ripgrep
sudo dnf upgrade
dnf search <term>; dnf info <pkg>

# Arch (pacman)
sudo pacman -Syu          # sync + upgrade (do together — partial upgrades break Arch)
sudo pacman -S ripgrep
sudo pacman -Rns ripgrep  # remove + unused deps + config
```

`apt update` refreshes the index; `upgrade` applies updates. On Arch always
`-Syu` together. Keep systems patched — it's the cheapest security control.

## Repositories and keys

Extra software often means adding a repository and its signing key. Do it the
modern way (keyrings, not the deprecated `apt-key`):

```bash
# Modern apt third-party repo (illustrative)
curl -fsSL https://example.com/key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/example.gpg
echo "deb [signed-by=/etc/apt/keyrings/example.gpg] https://example.com/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/example.list
sudo apt update
```

Only add repositories you trust; an added repo can ship anything as root on
every update.

## Desktop apps: Flatpak and Snap

Cross-distro, sandboxed GUI apps. Flatpak (Flathub) is the broad community
standard; Snap is Canonical's (default on Ubuntu for some apps). Good for
desktop applications and isolation; heavier than native packages. Pick one
primary and be consistent.

```bash
flatpak install flathub org.example.App
flatpak update
```

## Building from source — last resort

When no package exists:

```bash
./configure --prefix="$HOME/.local"   # install into your space, not /usr
make
make install
```

Install into `~/.local` or `/usr/local` (not `/usr`), keep the build inputs,
and prefer a tool that tracks it (`checkinstall`, or your own notes) so you can
remove it. For language libraries, use the language's own tooling (pip/venv,
npm, cargo, dotnet) — don't install language packages system-wide via apt where
the ecosystem manager is better. Runtimes and per-language setup → the language
skill.

## Updates and hygiene

Patch regularly; enable unattended security updates on servers (→
`linux-administration`). Remove what you don't use (`autoremove`); a smaller
install is a smaller attack surface.
