# Users, permissions and PAM (admin scale)

The permission *model* is in `linux-development/foundations.md`; this is
managing it on a multi-user server.

## Accounts

```bash
sudo useradd -m -s /bin/bash -G sudo alice   # create, home, shell, groups
sudo passwd alice
sudo usermod -aG docker alice                # add to a supplementary group (append!)
sudo userdel -r olduser                      # remove + home
getent passwd alice; groups alice            # inspect
```

- **Per-person accounts**, never a shared login — accountability and auditing
  depend on it.
- `usermod -aG` (note `-a`) *appends*; without `-a` you replace all
  supplementary groups (a classic lockout).
- **Service accounts** for daemons: a dedicated, non-login system user
  (`useradd -r -s /usr/sbin/nologin svc-app`) that owns only what it needs.

## sudo — scope it

Edit with `visudo` (syntax-checks before saving). Prefer dropping files in
`/etc/sudoers.d/`. Grant the minimum:

```
# /etc/sudoers.d/deploy
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart myapp
```

Avoid blanket `ALL=(ALL) ALL` for routine accounts, and avoid
`NOPASSWD: ALL` — scope to the specific commands a role needs. Audit who has
sudo regularly.

## ACLs and capabilities — beyond the triad

When owner/group/other isn't enough:

```bash
setfacl -m u:alice:rwx shared/      # grant a specific user, without chmod 777
getfacl shared/
```

**Capabilities** split root's powers so a process gets only what it needs
(e.g. bind a low port without full root):

```bash
sudo setcap 'cap_net_bind_service=+ep' /usr/local/bin/myapp
getcap /usr/local/bin/myapp
```

Prefer a capability over running a whole service as root.

## PAM (authentication framework)

PAM (`/etc/pam.d/`) is the pluggable stack that decides authentication, account
validity, password policy and session setup for login, sudo, sshd, etc. You
rarely write PAM modules, but you configure policy through it:

- Password quality (`pam_pwquality`) — length/complexity/history.
- Account lockout after failed attempts (`pam_faillock`).
- Limits per session (`pam_limits` → `/etc/security/limits.conf`): max open
  files, processes — relevant when a service hits `ulimit`.

Change PAM carefully and **keep a root session open** while testing — a broken
PAM stack can lock everyone out. Centralised auth (LDAP/Entra ID via SSSD)
plugs in here for fleets.
