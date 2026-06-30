---
name: secure-development
description: >-
  Secure software development and review: OWASP Top 10 (2025) and ASVS 5.0
  as review frameworks, STRIDE/data-flow threat modelling, secure SDLC
  practices, input/output handling, secrets and cryptography hygiene,
  dependency and supply-chain security — plus engineering-obligation
  references for NIS2, GDPR (privacy by design) and the EU AI Act. Use for
  ANY work involving application security, security reviews/audits, threat
  models, OWASP/ASVS, vulnerability remediation, secrets management,
  supply-chain risk, or developer-facing NIS2/GDPR/AI-Act compliance
  questions.
---

# Secure Development

Security engineering standards for building and reviewing software.
Grounded in OWASP (Top 10:2025, ASVS 5.0.0, Cheat Sheet Series), threat
modelling practice, and official EU sources for the compliance
references. Anthropic's security-guidance plugin (saved in Reference
skills) supplies the concrete sink list used in reviews.

## Framework versions (current June 2026 — verify before citing)

- **OWASP Top 10:2025** — published; supersedes 2021. Notable changes:
  A03 Software Supply Chain Failures (broadened from vulnerable
  components), A09 Logging **and Alerting** Failures, new A10
  Mishandling of Exceptional Conditions. Full list in
  `references/owasp-frameworks.md`.
- **OWASP ASVS 5.0.0** (May 2025) — ~350 requirements, 17 chapters;
  use as the verification checklist, levels 1–3 by risk.
- Compliance references inside this skill (engineering obligations,
  NOT legal advice): `references/nis2.md`, `references/gdpr.md`,
  `references/eu-ai-act.md` — each is date-stamped; regulatory state
  moves.

## Non-negotiables

1. **Never trust input; encode output for its context.** Parameterised
   queries always; context-appropriate encoding (HTML/attribute/URL/JS)
   at output time; allow-lists over deny-lists; canonicalise before
   validating paths. Sinks list: `references/input-output-crypto.md`.
2. **No secrets in code, config files in repos, logs, or prompts.**
   Key Vault/equivalent + managed identities; rotate on exposure;
   pre-commit secret scanning. A leaked secret is an incident, not a
   to-do.
3. **Boring cryptography only**: platform libraries, AES-GCM,
   TLS ≥1.2 verified (never disabled), Argon2id/bcrypt for passwords,
   no home-rolled constructions, no ECB, no MD5/SHA-1 for security
   purposes.
4. **AuthZ on every request, server-side, by policy not obscurity** —
   broken access control is A01 for a reason. Deny by default;
   object-level checks (IDOR); no client-side enforcement.
5. **Threat model anything new that crosses a trust boundary** — a
   lightweight STRIDE pass beats a skipped heavyweight one
   (`references/threat-modelling.md`).
6. **Pin and verify the supply chain**: lockfiles committed, SCA in
   CI, no install-time scripts from unvetted packages, provenance for
   artefacts (`references/supply-chain.md`).
7. **Fail closed and handle the exceptional path** (A10:2025): errors
   must not leak internals, bypass checks, or leave partial state;
   log security events with enough context to alert on (A09).
8. **Security review is evidence-based**: findings cite the code
   location, the framework item (Top 10/ASVS ID), exploitability and
   a concrete fix — severity by impact × exploitability, not vibes.
9. **No malicious-code assistance**: this skill hardens and reviews;
   it does not produce exploits, malware or bypasses.

## Review workflow (code/PR security review)

1. Scope: what changed, what trust boundaries it touches, what data
   classes flow through it.
2. Pattern sweep for known sinks (eval/Function, innerHTML-family,
   os.system/shell concat, unsafe deserialisation, XML parsers, TLS
   verification off, weak crypto modes — full list in
   `references/input-output-crypto.md`).
3. Trace data flow source→sink across files (IDOR, auth bypass and
   SSRF live in the joins, not the diffs).
4. Check the ASVS chapter relevant to the change (authn, session,
   access control, validation, crypto, logging).
5. Report: severity-ordered findings with Top 10/ASVS mapping,
   evidence, fix. Distinguish "vulnerability" from "hardening
   opportunity".

## Secure SDLC anchors

Requirements: data classification + abuse cases alongside user
stories. Design: threat model, trust-boundary diagram. Build:
linting/SAST + secret scanning + SCA in CI (tooling choices →
`devops-development`). Test: security test cases from the threat
model; DAST where exposed. Release: dependency + artefact provenance.
Operate: logging/alerting hooks (→ `sentinel-development`), incident
path, patch cadence. Evidence at each stage is what audits and NIS2
assessments ask for.

## References

| File | Load when |
|------|-----------|
| `references/owasp-frameworks.md` | Top 10:2025 detail, ASVS 5.0 usage, cheat sheet index |
| `references/threat-modelling.md` | STRIDE, data-flow diagrams, session facilitation |
| `references/input-output-crypto.md` | Injection/XSS defence, sinks, secrets, crypto rules |
| `references/supply-chain.md` | Dependencies, SBOM, build integrity, A03/A08 |
| `references/nis2.md` | NIS2 scope and developer-relevant obligations (incl. Irish status) |
| `references/gdpr.md` | Privacy by design for developers: minimisation, retention, DSR-ready models |
| `references/eu-ai-act.md` | AI Act risk classes, provider/deployer duties, timeline |

## Boundaries with sibling skills

- Pipeline/CI security, SHA pinning, OIDC → `devops-development`
  (`pipeline-security.md`).
- Azure platform security (Entra, network, Defender for Cloud) →
  `azure-development`.
- SIEM detections and SOC automation → `sentinel-development`.
- Per-language secure-coding refs already exist in each language
  skill — this skill is the cross-cutting framework layer.
