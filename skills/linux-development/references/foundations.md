# Linux foundations

The mental model the rest of Linux builds on. Get this and most commands become
obvious.

## Everything is a file

Files, directories, devices (`/dev/sda`), pipes, sockets, and kernel/process
state (`/proc`, `/sys`) are all presented through the filesystem. Reading and
writing "files" is how you interact with most of the system. There are no drive
letters — one tree rooted at `/`, and devices/partitions are **mounted** into
it.

## Filesystem Hierarchy Standard (FHS)

Know where things live:

- `/etc` — system configuration (text files).
- `/home/<user>` (`~`) — user data and per-user config (dotfiles).
- `/usr` — installed software (`/usr/bin`, `/usr/lib`); `/usr/local` for
  manually-installed.
- `/var` — variable data: logs (`/var/log`), spool, caches.
- `/tmp` — transient (cleared on reboot); `/opt` — self-contained third-party.
- `/proc`, `/sys` — virtual filesystems exposing kernel/process state.
- `/bin`, `/sbin` — essential binaries (usually symlinks into `/usr`).

## Processes and signals

Every running program is a **process** with a PID, a parent (PPID), an owning
user, and an environment. Process 1 (`init`/systemd) is the ancestor of all.

- Inspect: `ps aux`, `top`/`htop`, `pgrep`, `/proc/<pid>/`.
- Control via **signals**: `SIGTERM` (15, polite stop — let it clean up),
  `SIGKILL` (9, forced — last resort), `SIGHUP` (1, reload). `kill -TERM <pid>`,
  `kill -9` only when TERM fails.
- Foreground/background: `&`, `jobs`, `fg`/`bg`, `nohup`/`disown`; long jobs
  belong in `tmux`/`screen` or a systemd unit (→ `linux-administration`).
- Exit codes: `0` = success, non-zero = failure; `$?` holds the last.

## Permissions and ownership

Every file has an **owner**, a **group**, and three permission triads
(user/group/other), each `r` (4) `w` (2) `x` (1).

```bash
ls -l file            # -rw-r--r-- 1 alice devs ... file
chmod 640 file        # rw- r-- ---   (owner rw, group r, other none)
chmod u+x script.sh   # symbolic form
chown alice:devs file # set owner:group
```

- On a **directory**, `x` means "may traverse into it"; `r` means "may list".
- `umask` sets default permissions for new files.
- **Never `chmod 777`** to "fix" access — it grants everyone write. Find the
  correct owner/group instead.
- Special bits: **setuid/setgid** (run as file owner/group — security-sensitive)
  and the **sticky bit** on `/tmp` (only the owner can delete their files).
  Beyond basic modes, **ACLs** (`getfacl`/`setfacl`) and **capabilities** give
  finer control — admin depth in `linux-administration`.

## Users and root

A normal user can't touch others' files or system config; **root** (UID 0) can
do anything. You become root for a single command with `sudo`, configured in
`/etc/sudoers` (edit with `visudo`). Run as yourself; elevate deliberately.
