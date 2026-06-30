# GDPR — Privacy by Design for Developers

**Engineering-obligation reference, NOT legal advice.** GDPR itself is
stable (Regulation (EU) 2016/679); EDPB guidance evolves — check
edpb.europa.eu and dataprotection.ie (Irish DPC) for current
interpretations. Date-stamped June 2026.

## The engineering principles (Art. 5 + Art. 25)

Privacy by design and by default means the data model and defaults do
the compliance work:

1. **Minimisation**: collect only fields with a stated purpose. Every
   column of personal data is liability — challenge "nice to have"
   fields at design time, not DPIA time.
2. **Purpose limitation**: data collected for X isn't quietly reused
   for Y (incl. analytics and **model training** — flag any such reuse
   for a lawful-basis decision).
3. **Storage limitation → retention by design**: every personal-data
   store has a retention rule the SYSTEM enforces (TTL, scheduled
   purge, archival anonymisation) — "we keep it forever" is a finding.
4. **Accuracy**: correction paths exist (feeds rectification rights).
5. **Integrity & confidentiality**: encryption at rest/in transit,
   access control, pseudonymisation where full identity isn't needed
   (`input-output-crypto.md`).
6. **Defaults**: opt-in not pre-ticked; least data shared by default;
   private-by-default visibility.

## DSR-ready data models (the part that bites late)

Design so Data Subject Rights are queries, not archaeology:

- **Access/portability (Art. 15/20)**: enumerate everywhere a subject's
  data lives — keyed by a stable subject identifier across services;
  export in structured machine-readable form.
- **Erasure (Art. 17)**: deletion must reach replicas, caches, search
  indexes, queues, analytics sinks and BACKUPS (documented backup
  expiry strategy is the accepted pattern); soft-delete is not
  erasure; third-party processors need propagation.
- **Rectification/restriction/objection**: updatable records, a
  "processing restricted" flag the application honours.
- Logs: personal data in logs is still personal data — minimise
  (pseudonymous IDs, not names/emails), retention-bound, and excluded
  from erasure only where a documented exemption applies.

## Build-time obligations checklist

- **Records of processing**: the data-flow diagram from
  `threat-modelling.md` doubles as the engineering input — data
  classes, purposes, processors, transfers.
- **Lawful basis surfaced**: consent capture (granular, withdrawable,
  logged) where consent is the basis; don't build consent UX for
  processing justified otherwise.
- **DPIA triggers**: large-scale special-category data, systematic
  monitoring, innovative tech (AI features — see `eu-ai-act.md`
  overlap) → flag to the client's DPO; engineers supply the data-flow
  facts.
- **Processors & transfers**: every SaaS/API receiving personal data
  needs a DPA; non-EEA transfers need a mechanism (adequacy/SCCs) —
  surface the inventory from `supply-chain.md`.
- **Breach readiness**: 72-hour notification clock to the DPC —
  detection and evidence requirements mirror `nis2.md`; design
  logging so you can answer "whose data, what data, since when".
- **Special categories (Art. 9)**: health, biometrics etc. need a
  specific condition — architectural isolation and stricter access
  are the engineering response.

## Anonymisation vs pseudonymisation

Pseudonymised data (reversible via a key you hold) IS personal data —
all obligations apply; it's a mitigation. Anonymised data (no
reasonable re-identification) exits GDPR — but aggregation/k-anonymity
claims fail under scrutiny more often than teams think; treat
"anonymised" claims as requiring justification.

## Review prompts for any feature

What personal data? Why (purpose/basis)? Where stored, how long, who
accesses? How does it leave (exports, processors, logs)? Can we
answer an access request? Can we delete it everywhere? What's the
default state?

Irish context: supervisory authority is the Data Protection
Commission; public bodies have additional FOI interplay — flag, don't
adjudicate.
