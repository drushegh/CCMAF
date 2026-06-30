# Networking and SSH

## Inspecting the network

```bash
ip addr; ip route                 # interfaces and routing (not ifconfig/route)
ss -tulpn                          # listening sockets + owning process
resolvectl status                  # DNS (systemd-resolved)
ping host; traceroute host; mtr host
curl -v https://host/health        # app-level reachability
```

`ss` replaces `netstat`; `ip` replaces `ifconfig`/`route`. To find *what's
listening on a port and which process owns it*, `ss -tulpn` is the first stop.

## DNS

Most modern distros use **systemd-resolved** (`resolvectl`); `/etc/resolv.conf`
is often a symlink it manages. Per-link DNS, caching and DNSSEC live here. On
cloud VMs DNS is usually provided by the platform — don't hand-edit
`/etc/resolv.conf` if resolved manages it; configure the link or netplan/
NetworkManager instead.

## Firewall — default deny

Pick one front-end and be consistent. All are backed by **nftables** now.

```bash
# ufw (Ubuntu/Debian)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp          # keep SSH BEFORE enabling, or you lock out
sudo ufw allow 443/tcp
sudo ufw enable; sudo ufw status verbose
```

```bash
# firewalld (RHEL) — zone-based
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload; sudo firewall-cmd --list-all
```

Rules: deny inbound by default, open only documented ports, and **always keep
your current SSH session's access** when changing rules remotely. For egress
control on sensitive hosts, restrict outbound too. nftables directly
(`/etc/nftables.conf`) when you need explicit, fine-grained rule sets.

## SSH server hardening

`/etc/ssh/sshd_config` (or a drop-in in `sshd_config.d/`):

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowGroups ssh-users
X11Forwarding no
```

```bash
sudo sshd -t                 # validate config BEFORE reloading
sudo systemctl reload ssh    # (ssh or sshd depending on distro)
```

- **Key-only, no root login** is the baseline. Manage keys via
  `~/.ssh/authorized_keys` (or central CA/OIDC for fleets).
- Validate with `sshd -t` and keep a second session open while reloading — a
  bad config plus a closed session is a lockout.
- Pair with **fail2ban** and a firewall (`security-hardening.md`); consider a
  non-standard port only as noise reduction, not security.

## Remote access patterns

Bastion/jump host for private fleets; `ssh -J bastion target` to hop. On Azure,
prefer Bastion / Just-in-time access over public SSH where possible (→
`azure-development`). Avoid long-lived shared keys; rotate.
