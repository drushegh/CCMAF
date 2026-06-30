# Automation and backups

Servers should be reproducible and self-maintaining. Automate routine work,
manage config as code, and back up with tested restores.

## Scheduling: cron vs systemd timers

| | cron | systemd timer |
|---|---|---|
| Logging | redirect yourself | journald per service |
| Missed runs (downtime) | lost | `Persistent=true` catches up |
| Dependencies / order | none | `After=`/`Requires=` |
| Load spreading | manual | `RandomizedDelaySec` |

```bash
# cron — still fine for simple, user-level jobs
crontab -e
# m h dom mon dow  command
0 3 * * *  /usr/local/bin/cleanup.sh
```

Prefer **systemd timers** (`systemd-services.md`) for anything you need logged,
dependency-aware, or resilient to downtime; cron is fine for simple personal
jobs. Either way, the job is a script with strict-mode discipline →
`bash-development`.

## Backups — and restore testing

```bash
# restic example (dedup, encrypted, many backends incl. Azure Blob)
restic -r azure:bucket:/path backup /var/lib/myapp /etc/myapp
restic -r azure:bucket:/path snapshots
restic -r azure:bucket:/path restore latest --target /tmp/restore-test   # TEST it
```

- Back up **data and config** (`/etc`, app state), not the whole disk where a
  rebuild is cheaper.
- **Encrypt** backups and store **off-host** (another region/account).
- **Test restores on a schedule** — a backup is worthless until a restore has
  succeeded. Automate a periodic restore-verify.
- Know your RPO/RTO and design the backup frequency/retention to meet them.

## Config as code

Don't hand-edit `/etc` and forget — irreproducible after a rebuild or during an
incident. Manage server state declaratively:

- **cloud-init** for first-boot provisioning (cloud VMs).
- **Ansible** (agentless, SSH) for ongoing config across a fleet — idempotent
  playbooks describing the desired state.
- At minimum, **version-control** your `/etc` changes and document them.

Idempotency is the goal: running the automation again converges to the same
state, never breaks a correct one. (CI/CD that drives this →
`devops-development`; immutable infra / golden images → `azure-development`.)

## Routine maintenance to automate

Patching (unattended security upgrades), log/journal vacuuming, backup +
restore-verify, certificate renewal (`certbot`/ACME), disk-space and health
checks with alerting (`observability-logging.md`). Automate the boring,
forgettable tasks — they're the ones that cause 3am incidents when skipped.
