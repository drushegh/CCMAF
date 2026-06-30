---
name: linux-administration
description: >-
  Operating Linux servers: systemd service and unit management, networking and
  firewalls (ip, nftables/firewalld/ufw, DNS, SSH server), users/groups/sudo
  and PAM at admin scale, performance troubleshooting (the saturation method,
  perf/strace), security hardening (SSH, SELinux/AppArmor, CIS benchmarks,
  fail2ban, patching), logging/observability (journald, log shipping), and
  automation (cron/systemd timers, backups). Use for server-side Linux tasks:
  "configure a service", "systemd unit", "harden the server", "set up the
  firewall", "SSH config", "the server is slow", "journalctl", "cron job",
  "CIS benchmark". Triggers include /etc/systemd/system unit files, sshd_config,
  nftables/firewalld rules. Assumes the Linux foundations from
  linux-development.
---

# Linux Administration

Operating and securing Linux **servers**. This skill assumes the foundations
(filesystem, permissions, processes, packages, shell) defined in
`linux-development` — load that for the model; this is the production
server layer. Default context is Ubuntu/Debian and RHEL-family hosts (cloud
VMs, AKS nodes' OS, on-prem), much of it reached via SSH.

Context (June 2026 — re-verify): systemd is the init/service manager
everywhere; `nftables` is the modern firewall backend (`firewalld`/`ufw` are
front-ends); CIS Benchmarks are the common hardening baseline. Pin specifics to
the distro/version in front of you.

## Non-negotiables

1. **SSH hardened from the start.** Key-based auth only
   (`PasswordAuthentication no`), **no root login**
   (`PermitRootLogin no`), a non-default approach to brute force (fail2ban /
   rate limiting). A fresh server's first job is locking down SSH.
2. **Least privilege.** Per-user accounts, scoped `sudo` (not shared root,
   not blanket `ALL`), service accounts for services. Audit `sudoers` with
   `visudo`.
3. **Firewall default-deny.** Inbound denied except the ports you explicitly
   open; document every open port. Egress filtering for sensitive hosts.
4. **Services are systemd units.** Long-running processes run as managed,
   restart-on-failure, logged systemd services with their own user — never
   `nohup ... &`, a `screen` session, or `@reboot` cron hacks.
5. **Patch and stay patched.** Apply security updates promptly; enable
   unattended security upgrades; track what's installed. Unpatched is the
   commonest breach vector.
6. **Logs and metrics leave the box.** Centralise logs (journald → shipper)
   and metrics; a server you can't observe is a server you can't operate. Deep
   platform observability → `azure-development`/`sentinel-development`.
7. **Backups exist only once a restore has succeeded.** Automate backups of
   data and config, and **test restores** — an untested backup is a hope.
8. **Config as code.** Manage server config reproducibly (cloud-init, Ansible,
   or at least version-controlled `/etc` changes); avoid undocumented
   hand-edits that no one can reproduce after an outage.

## Decision tables

| Need | Tool |
|---|---|
| Run/manage a service | **systemd unit** (`systemctl`, journald) |
| Firewall (Ubuntu/Debian, simple) | **ufw** (front-end to nftables) |
| Firewall (RHEL/zones) | **firewalld** | 
| Firewall (fine-grained/explicit) | **nftables** directly |
| Schedule a job | **systemd timer** (preferred: logged, dependencies) or cron |
| Mandatory access control | **SELinux** (RHEL) / **AppArmor** (Ubuntu) — keep enforcing |
| Brute-force protection | **fail2ban** + key-only SSH |

## High-frequency pitfalls

- **Password SSH / root login left on** — the front door wide open.
- **`chmod 777` / overly broad `sudo`** — privilege sprawl; fix ownership and
  scope instead.
- **Services via `nohup`/`screen`/`@reboot`** — no restart, no logs, no
  dependencies; use a systemd unit.
- **Disabling SELinux/AppArmor to "make it work"** — fix the policy/context;
  `setenforce 0` is not a solution.
- **Firewall allow-all or untested rules** — lock yourself out (always keep a
  console/session path when changing SSH/firewall remotely).
- **No log rotation / disk fills with logs** — `/var/log` fills, server falls
  over; configure rotation and retention.
- **Editing `/etc` by hand with no record** — irreproducible after a rebuild;
  manage with config-as-code.
- **Backups never restore-tested** — discovered worthless during the incident.

## Workflow (bring up / operate a server)

1. **Harden first**: non-root sudo user, key-only SSH, no root login, firewall
   default-deny + only needed ports, updates on, MAC enforcing, fail2ban.
2. Deploy the app/service as a **systemd unit** with its own user, resource
   limits and restart policy.
3. Wire **logging** (journald + shipper) and **monitoring/alerts**; set log
   rotation.
4. Schedule maintenance (timers): backups, cleanup, patching; **test restores**.
5. Operate from the **saturation method** when troubleshooting (CPU, memory,
   IO, network — `performance-troubleshooting.md`), not guesswork.
6. Change config as code; review against a **CIS baseline** periodically.

## Reference index

Load on demand:

- `references/users-permissions-pam.md` — users/groups, sudo, ACLs, capabilities, PAM
- `references/systemd-services.md` — units, services, timers, journald, resource control
- `references/networking.md` — ip/ss, DNS, firewall (nftables/firewalld/ufw), SSH server
- `references/performance-troubleshooting.md` — saturation method, CPU/mem/IO/net, perf/strace
- `references/security-hardening.md` — SSH hardening, SELinux/AppArmor, CIS, fail2ban, patching
- `references/observability-logging.md` — journald, log shipping, rotation, metrics, alerting
- `references/automation.md` — cron vs timers, backups/restore, config management, cloud-init

## Boundaries

- **The Linux model and workstation/WSL2 use** → `linux-development` (this skill
  builds on its foundations).
- **Shell *scripting*** (robust `.sh`, strict mode, BATS) → `bash-development`.
- **Linux *in containers*** (the node OS vs a container) →
  `containers-development` / `kubernetes-development` (AKS node OS).
- **Provisioning Linux VMs, Azure networking, Azure Monitor/Defender** →
  `azure-development`; **SIEM/KQL detection** → `sentinel-development`.
- **CI/CD that deploys to servers** → `devops-development`.
