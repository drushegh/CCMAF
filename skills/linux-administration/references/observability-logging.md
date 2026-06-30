# Observability and logging

A server you can't observe is a server you can't operate. Get logs and metrics
**off the box** to somewhere durable and queryable.

## journald — the local journal

systemd captures unit stdout/stderr into the journal (`systemd-services.md`).
On servers, make it **persistent** and bounded:

```bash
# /etc/systemd/journald.conf
[Journal]
Storage=persistent
SystemMaxUse=1G
MaxRetentionSec=2week
```

```bash
journalctl -p err --since today
journalctl -u myapp --since "09:00" --until "10:00"
journalctl -k          # kernel messages
```

## Log rotation for classic logfiles

Anything writing to `/var/log/*.log` needs **logrotate** or it fills the disk
(a top cause of server outages):

```
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
```

## Shipping logs off-box

A local journal is lost when the box dies. Ship to a central store:

- **rsyslog** (forward syslog), **Vector** or **Fluent Bit** (modern shippers,
  parse + route) → Loki/Elasticsearch/Splunk, or **Azure Monitor / Log
  Analytics** via the Azure Monitor Agent.
- Structure logs (JSON) where you can so they're queryable.
- KQL/SIEM analysis of shipped logs → `sentinel-development`; Azure-side
  pipeline → `azure-development`.

## Metrics and alerting

- **node_exporter + Prometheus + Grafana** is the open-source standard for host
  metrics (CPU/mem/disk/net); on Azure, the **Azure Monitor Agent** with
  managed Prometheus.
- Alert on **symptoms that matter** — disk nearly full, sustained saturation,
  service down/restart-looping, auth-failure spikes — not on every fluctuation.
  Alert fatigue is as dangerous as no alerts.
- Track a **baseline** so alerts are deviation-based (ties to
  `performance-troubleshooting.md`).

## What to capture

- System: journald + host metrics + audit (auditd).
- Per service: its unit's journal, app logs (shipped), and a health/liveness
  signal.
- Security: auth logs, sudo use, fail2ban actions, SELinux/AppArmor denials.
Keep retention proportionate (cost vs forensic need), and **don't log secrets
or unnecessary PII** (→ `secure-development`).
