# Threat Modelling (STRIDE, data-flow oriented)

Answer Shostack's four questions: What are we building? What can go
wrong? What are we going to do about it? Did we do a good job?
Lightweight and early beats heavyweight and late — a one-hour pass on
a new integration is the highest-leverage security activity available.

## 1. Model the system (data-flow first)

Draw the DFD: external entities, processes, data stores, data flows —
and **trust boundaries** (internet→app, app→DB, tenant→tenant,
user→admin plane, cloud account edges, third-party APIs, CI→prod).
Threats live where flows cross boundaries. Label data classes on
flows (personal data, credentials, financial) — this feeds
`gdpr.md` records and NIS2 risk measures too.

## 2. Enumerate threats — STRIDE per element

| Threat | Violates | Prompt questions |
|--------|----------|-----------------|
| **S**poofing | Authentication | Can a caller pretend to be another user/service? Token validated? mTLS/audience checks? |
| **T**ampering | Integrity | Can data be modified in transit/at rest/in the queue? Signatures? Constraints? |
| **R**epudiation | Non-repudiation | Could a user deny an action? Audit trail with actor, time, integrity? |
| **I**nformation disclosure | Confidentiality | Where can data leak — errors, logs, caches, URLs, side channels, verbose APIs? |
| **D**enial of service | Availability | What's unbounded — uploads, queries, loops, fan-out? Rate limits? Quotas? |
| **E**levation of privilege | Authorisation | Can a low-priv path reach high-priv function? Deserialisation? Injection→RCE? Confused deputy? |

Apply per DFD element (processes get all six; data stores mostly
T/I/D; flows mostly T/I/D; external entities S/R). Record as: threat,
affected element, attack scenario, existing mitigations.

## 3. Decide responses

Mitigate (control), eliminate (remove the feature/flow), transfer
(contract/insurer/platform), accept (explicitly, with owner and
review date — undocumented acceptance is just negligence). Rank by
risk = impact × likelihood; map mitigations to ASVS requirements so
verification is testable (`owasp-frameworks.md`).

## 4. Validate

Each high/medium threat has: a mitigation implemented, a test proving
it, or a signed acceptance. Re-run the model when architecture
changes (new integration, new data class, new trust boundary) — not
on a calendar.

## Session mechanics (consultancy reality)

- Attendees: feature engineers + architect + someone who can say no.
  60–90 min cap; one whiteboard DFD; STRIDE prompts per boundary.
- Output is a table, not a document: threats, decisions, owners.
  Park rabbit holes fast ("attacker has the DB" → separate
  conversation about layered controls).
- For agents doing this solo: build the DFD from the codebase
  (entry points, data stores, external calls), then walk STRIDE per
  boundary mechanically — flag uncertainties for humans rather than
  guessing infra facts.
- Common blind spots: background jobs/queues (no authn between
  stages), webhooks (unverified callers), file uploads (path,
  content type, size, processing), admin tooling, CI/CD itself
  (→ `supply-chain.md`), LLM features (prompt injection = untrusted
  input crossing into a privileged tool-calling context).

## Cloud/Microsoft-stack notes

Managed platforms move threats, not remove them: misconfiguration
(A02) replaces patching; identity is the perimeter (token audience/
scope validation, managed identities); cross-tenant isolation in
multi-tenant SaaS deserves its own STRIDE pass. Platform-specific
controls → `azure-development`; detection of the residual risks →
`sentinel-development`.
