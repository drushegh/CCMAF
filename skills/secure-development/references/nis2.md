# NIS2 — Engineering Obligations Reference

**Engineering-obligation reference, NOT legal advice.** Regulatory
state date-stamped **June 2026** — verify on NCSC.gov.ie and eur-lex
before contractual commitments; the Irish position is in flux.

## What it is

Directive (EU) 2022/2555 — cybersecurity risk-management and
incident-reporting obligations for **essential** and **important**
entities across 18 sectors (energy, transport, health, water, digital
infrastructure, public administration, digital providers,
manufacturing of critical products, etc.), with size thresholds
(generally ≥50 staff or ≥€10m turnover, with sector exceptions).
Management bodies carry personal accountability for approving and
overseeing the risk measures.

## Status (June 2026)

- EU transposition deadline was 17 October 2024. **Ireland missed it**
  and faces infringement proceedings; the **National Cyber Security
  Bill** (General Scheme Sep 2024) is the transposition vehicle and
  was still progressing as of this writing — check current enactment
  status before citing Irish legal force.
- **NCSC-IE has published its proposed Risk Management Measures
  (RMMs) and the Cyber Fundamentals framework (24 June 2025)** —
  the practical Irish compliance baseline to design against now,
  regardless of the Bill's timing.
- Regulated entities and their suppliers are in scope ranges —
  expect NIS2-derived requirements in regulated ICT environments even
  before/regardless of transposition.

## Developer-relevant obligations (Article 21 risk measures)

| Obligation | What engineering actually does |
|------------|-------------------------------|
| Risk analysis & infosec policies | Threat models (`threat-modelling.md`), data classification, documented security architecture |
| Incident handling | Logging/alerting wired (A09), runbooks, evidence preservation; detection → `sentinel-development` |
| Business continuity | Backups (tested restores), DR design, RTO/RPO in architecture decisions |
| **Supply-chain security** | Everything in `supply-chain.md`: SBOMs, vetting, pinning, vendor risk documentation |
| Security in acquisition, development & maintenance | Secure SDLC evidence: reviews, SAST/SCA gates, vulnerability handling & disclosure process, patch SLAs |
| Effectiveness assessment | Pen tests, audits, metrics — scheduled and recorded |
| Cyber hygiene & training | Developer security training records count |
| Cryptography | Policy + implementation per `input-output-crypto.md` |
| HR security, access control, asset management | Least privilege, joiner/mover/leaver, MFA, asset inventories |
| MFA / secured comms | MFA on build systems and admin planes, not just end users |

## Incident reporting (the timeline that surprises people)

Significant incidents: **early warning within 24 hours** to the CSIRT/
competent authority, incident notification within 72 hours, final
report within one month. Engineering implication: detection,
triage and evidence pipelines must exist BEFORE the incident
(→ `sentinel-development`), and contracts must define who notifies.

## Penalties (directive baseline)

Essential entities: up to €10m or 2% global turnover; important:
up to €7m or 1.4%. Management liability attaches — which is why
boards now fund the items above.

## Compliance framing

Map security documentation to Article 21 measures explicitly;
reference NCSC-IE RMMs/Cyber Fundamentals alignment for relevant
regulated entities; evidence over adjectives (named processes, tools,
SLAs, test cadences). Flag scope determinations (essential vs
important vs out of scope) as the client's legal call.
