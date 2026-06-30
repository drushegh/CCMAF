# Performance troubleshooting

Diagnose with a **method**, not guesswork. The USE method: for each resource
(CPU, memory, disk IO, network) check **U**tilisation, **S**aturation,
**E**rrors. Start broad, then drill into the saturated resource.

## First look

```bash
uptime              # load average (1/5/15 min) vs core count
top                 # or htop — live per-process CPU/mem
vmstat 1 5          # system-wide CPU/mem/IO/swap over time
dmesg --level=err,warn   # hardware errors, OOM kills
```

Load average > number of cores sustained = CPU saturation (or IO wait). `top`'s
`%wa` (IO wait) high means the bottleneck is disk, not CPU.

## CPU

```bash
mpstat -P ALL 1         # per-core utilisation (sysstat)
pidstat 1               # per-process CPU
ps -eo pid,comm,%cpu --sort=-%cpu | head
```

User vs system vs iowait split tells you whether it's your code, the kernel, or
waiting on IO. A single pegged core = single-threaded hotspot.

## Memory

```bash
free -h                 # used/free/available, swap
vmstat 1                # si/so columns = swapping (bad)
ps -eo pid,comm,%mem --sort=-%mem | head
```

Linux uses free RAM for cache — look at **available**, not "free". Active
**swapping** (si/so) or an **OOM-killer** entry in `dmesg`/journal means you're
out of memory; raise the limit or fix the leak.

## Disk IO

```bash
iostat -xz 1            # per-device util%, await, queue (sysstat)
sudo iotop              # per-process IO
df -h; du -xh / | sort -h | tail   # space (a full disk looks like many bugs)
```

High `%util` + rising `await` = disk saturation. A **full filesystem** causes
bizarre, cascading failures — check `df -h` early.

## Network

```bash
ss -s                   # socket summary
ss -tn state established
sar -n DEV 1            # throughput per interface (sysstat)
```

Connection pile-ups (many `TIME-WAIT`/`CLOSE-WAIT`), interface saturation, or
DNS latency all masquerade as "the app is slow".

## Going deeper

```bash
sudo strace -p <pid> -f -e trace=network,file   # syscalls a process makes
sudo perf top                                    # live CPU hotspots (kernel+user)
```

`strace` shows what a stuck process is actually doing (which syscall it's
blocked on); `perf` finds CPU hotspots. Use them once the USE method has
pointed at the resource.

## Discipline

Establish a **baseline** (what normal looks like) so you can spot deviation.
Change one variable at a time and re-measure. Correlate with logs
(`observability-logging.md`) and, for app-level latency under load,
`testing-development`'s load-performance reference. Platform-level metrics on
Azure → `azure-development`.
