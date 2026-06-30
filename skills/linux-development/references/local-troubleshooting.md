# Local troubleshooting

Diagnose from the model (`foundations.md`): for any problem ask *which process,
which file, whose permission, which path, what do the logs say?* Server-scale
performance triage (saturation method, `perf`, monitoring) is in
`linux-administration` — this is the workstation/dev-box layer.

## "Command not found / wrong version"

```bash
type -a tool        # every match on PATH, in order (first wins)
which -a tool
echo "$PATH" | tr ':' '\n'
hash -r             # clear the shell's command cache after installs
```

Usually a `$PATH` ordering issue or a shell-init file not sourced (see
`shell-environment.md`). A version manager (pyenv/nvm) shimming the binary is a
common cause of "wrong version".

## "Permission denied"

```bash
ls -l file          # owner, group, mode
id                  # your uid/gids
namei -l /path/to/file   # permission at every level of the path
stat file
```

Check ownership and each directory's `x` (traverse) bit — you need `x` on every
parent to reach a file. Fix by correcting owner/group or mode **minimally**
(never `chmod 777`). Editing a root-owned file? `sudoedit`/`sudo -e`, not
`chmod`.

## "What's using my CPU / memory / port / file?"

```bash
top        # or htop — live CPU/mem by process
ps aux --sort=-%cpu | head
free -h    # memory
sudo ss -tulpn          # listening ports and the owning process
sudo lsof -i :8080      # who holds a port
sudo lsof /path/file    # who has a file open (e.g. "device busy")
```

To stop a process: `kill -TERM <pid>` first, `kill -9` only if it ignores TERM.

## "Disk full / where did my space go?"

```bash
df -h               # filesystem usage (which mount is full)
du -sh ./* | sort -h # biggest items in the current dir
du -xh / 2>/dev/null | sort -h | tail   # biggest on the root fs
```

Common culprits: logs in `/var/log`, package caches, Docker images/volumes, a
runaway file. `df` shows *which* filesystem; `du` finds *what* fills it.

## Logs

```bash
journalctl -xe                    # recent system journal, with explanations
journalctl --user -u myapp        # a user service's logs
dmesg --level=err,warn            # kernel ring buffer (hardware, OOM kills)
tail -f /var/log/syslog           # follow a classic logfile
```

An OOM-killed process shows in `dmesg`/journal as the kernel reclaiming memory.

## A method, not a guess

1. Reproduce and read the *exact* error (don't paraphrase it away).
2. Locate the layer: command/PATH, file/permission, process, network, disk,
   kernel.
3. Inspect with the tool for that layer (above).
4. Change one thing, re-test. For services, systemd status/logs →
   `linux-administration`.
