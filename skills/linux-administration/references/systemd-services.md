# systemd: services and timers

systemd is the init system and service manager. Run anything long-lived as a
**unit** — supervised, restarted on failure, logged to the journal, with
dependencies and resource limits. Never `nohup`/`screen`/`@reboot` for a real
service.

## Service unit anatomy

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My App
After=network-online.target
Wants=network-online.target

[Service]
User=svc-app
Group=svc-app
ExecStart=/usr/local/bin/myapp --config /etc/myapp/config.toml
Restart=on-failure
RestartSec=5
# Hardening (least privilege)
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/myapp
# Resource limits
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload          # after editing unit files
sudo systemctl enable --now myapp     # start now + on boot
systemctl status myapp                 # state, recent logs
sudo systemctl restart myapp
systemctl list-units --failed          # what's broken
```

Key directives: `Restart=on-failure` (resilience), a **dedicated `User=`** (not
root), and the `Protect*`/`Private*`/`NoNewPrivileges` sandbox directives —
these are free hardening, use them. Resource control (`MemoryMax`, `CPUQuota`)
is enforced via cgroups.

## Timers — better than cron for managed jobs

A timer unit triggers a service unit. Advantages over cron: logged to the
journal, dependency-aware, `Persistent=true` runs a missed job after downtime,
and randomised delays spread load.

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Nightly backup

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
```

Pair with a `backup.service` (Type=oneshot). `systemctl list-timers` shows
schedules and last/next run. (cron vs timers → `automation.md`.)

## journald

systemd captures each unit's stdout/stderr into the journal:

```bash
journalctl -u myapp -f               # follow a unit
journalctl -u myapp --since "1 hour ago" -p err
journalctl --disk-usage; sudo journalctl --vacuum-time=2weeks
```

Make the journal **persistent** (`Storage=persistent` in
`/etc/systemd/journald.conf`) on servers, and cap its size. Shipping the
journal off-box → `observability-logging.md`.

## Useful targets and tools

`systemctl` for state, `systemd-analyze blame` for slow boots,
`systemctl cat`/`edit` to view/override units (drop-ins in
`/etc/systemd/system/<unit>.d/`). Override vendor units with drop-ins rather
than editing them in place.
