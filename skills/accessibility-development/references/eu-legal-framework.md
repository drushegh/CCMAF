# EU and Irish Accessibility Legal Framework

Engineering-obligation reference, **not legal advice**. Regulatory
positions date-stamped **June 2026** — verify current status (NDA.ie,
eur-lex, ETSI) before relying on them in contractual commitments.

## The three instruments

| Instrument | Applies to | Technical bar |
|------------|-----------|---------------|
| **Web Accessibility Directive** (EU 2016/2102) | Public sector bodies' websites + mobile apps | Harmonised standard = EN 301 549 |
| **EN 301 549 v3.2.1** (2021) | The harmonised standard itself | WCAG 2.1 AA for web + non-web clauses |
| **European Accessibility Act** (EU 2019/882) | Private-sector products/services: e-commerce, banking, transport, e-books, terminals, comms | EN 301 549 is the presumption-of-conformity route |

## Web Accessibility Directive (public sector bodies)

- Websites and mobile apps of public sector bodies must be
  perceivable, operable, understandable, robust — practically:
  conform to EN 301 549.
- **Accessibility statement** required per site/app: conformance
  status, non-accessible content with justification (disproportionate
  burden must be argued, not asserted), feedback mechanism, link to
  enforcement procedure. Review/update regularly.
- Ireland: transposed by S.I. No. 358/2020; the **National Disability
  Authority** is the monitoring body, running simplified (automated)
  and in-depth monitoring rounds and reporting to the Commission.
  Irish public bodies also carry Disability Act 2005 obligations
  (Code of Practice on Accessibility of Public Services).
- Compliance consequence: accessibility is frequently a scored, explicit requirement; cite EN 301 549 + WAD obligations and the
  monitoring regime, and commit to evidence (audit method, statement
  maintenance), not adjectives.

## EN 301 549 — what's beyond WCAG (the bit bids miss)

Clause 9 covers web (≙ WCAG 2.1 AA in v3.2.1). The rest extends
further; flag whichever apply to the solution:

- **Clause 5** Generic (incl. closed-functionality ICT, biometrics).
- **Clause 6** Two-way voice; **Clause 7** video capabilities
  (captions, AD).
- **Clause 10** Non-web documents (PDFs, Office files shipped with
  the service).
- **Clause 11** Non-web software (desktop/native mobile apps,
  including platform AT interop).
- **Clause 12** Documentation and support services (help desks must
  accommodate; docs must be accessible).
- **Clause 13** Relay/emergency comms.

**Version status (June 2026):** v3.2.1 (2021, WCAG 2.1 AA) is the
cited harmonised version; **draft 4.1.1 incorporating WCAG 2.2 AA is
expected to publish in 2026** — build to WCAG 2.2 AA now so the
revision is a no-op.

## European Accessibility Act

- In force for in-scope products/services placed on the market since
  **28 June 2025** (legacy service contracts have transition windows
  to 2030 for some categories — verify per case).
- Ireland: transposed into Irish law (transposition was late but is
  in place — verify the current S.I. when citing).
- Scope is product/service based, not body based: e-commerce,
  consumer banking, e-books, transport information/ticketing,
  electronic communications, self-service terminals, and the digital
  elements around them.
- Microenterprise service-provider exemption exists; conformity
  assessment + CE marking applies to products; market surveillance
  authorities enforce.
- Engineering takeaway: for private-sector clients in scope, EN 301
  549 conformance moved from differentiator to legal necessity in
  June 2025 — frame remediation roadmaps accordingly.

## Practical artefacts this skill produces

1. **Accessibility statements** (WAD format: conformance status,
   exceptions + justification, feedback channel, enforcement link,
   preparation date/method).
2. **EN 301 549 clause mapping** for solution components (web app →
   clause 9; native app → 11; PDFs → 10; support desk → 12).
3. **VPAT-style conformance tables** (Supports / Partially Supports /
   Does Not Support / Not Applicable per criterion) where buyers ask.
4. **Remediation roadmaps** with severity (see `audit-checklist.md`)
   and statutory deadlines where applicable.

When producing any of these, label legal interpretations as
interpretations and recommend client legal review for scope edge
cases (e.g. EAA applicability calls, disproportionate-burden claims).
