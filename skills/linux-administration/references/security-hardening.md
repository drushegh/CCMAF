# Security hardening

Defence in depth on the host. Work to a recognised baseline (**CIS Benchmarks**
for the distro) rather than ad-hoc tweaks, and automate the checks.

## The baseline (a fresh server's first hour)

1. **Patch**: `apt update && apt upgrade` / `dnf upgrade`; enable **unattended
   security updates**.
2. **Accounts**: a non-root sudo user; disable direct root login.
3. **SSH**: key-only, no root, `sshd -t` then reload (see `networking.md`).
4. **Firewall**: default-deny inbound, open only needed ports.
5. **MAC enforcing**: SELinux/AppArmor on and enforcing.
6. **fail2ban** for brute-force; **auditd** for an audit trail.
7. Remove unused packages/services (smaller attack surface).

## Patching

```bash
# Ubuntu/Debian unattended security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Unpatched software is the most common breach vector. Subscribe to the distro's
security advisories; reboot for kernel updates (or use livepatch where
available).

## SELinux / AppArmor — keep it enforcing

Mandatory Access Control confines processes even if compromised.

```bash
getenforce                 # SELinux: Enforcing (don't set Permissive/Disabled)
sudo ausearch -m avc -ts recent   # what SELinux denied (then fix the policy)
sudo aa-status             # AppArmor (Ubuntu): profiles loaded/enforcing
```

When a service breaks under SELinux/AppArmor, **fix the policy/context**
(`semanage`/`restorecon`, or the AppArmor profile) — never `setenforce 0` or
disable the profile as a "fix". That trades a config problem for a security
hole.

## fail2ban

Bans IPs after repeated auth failures (SSH and more):

```bash
sudo apt install fail2ban
# /etc/fail2ban/jail.local : [sshd] enabled=true, maxretry=5, bantime=1h
sudo fail2ban-client status sshd
```

Key-only SSH already defeats password brute force; fail2ban cuts the noise and
covers other services.

## CIS benchmarks and audit

- Assess against the **CIS Benchmark** for your distro (OpenSCAP / `oscap`,
  or vendor tooling). Treat findings as a prioritised backlog, not a pass/fail
  vanity metric.
- **auditd** records security-relevant events (file access, privilege use) for
  forensics and compliance.
- On Azure, **Microsoft Defender for Servers** and **Azure Policy** /
  machine-configuration assess and enforce baselines at scale → cross-ref
  `azure-development`; SIEM correlation → `sentinel-development`.

## Secrets and least privilege

No plaintext secrets in `/etc`, scripts, or env files world-readable; restrict
modes (`600`/`640`, correct owner). Services run as their own non-root user
(`systemd-services.md`) with only the capabilities they need
(`users-permissions-pam.md`). Encrypt data at rest where required (LUKS) and in
transit (TLS).
