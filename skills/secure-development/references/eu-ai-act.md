# EU AI Act — Engineering Obligations Reference

**Engineering-obligation reference, NOT legal advice.** This area is
moving FAST — timeline below reflects **June 2026** including the
provisional Digital Omnibus changes; verify on the Commission's AI
Act pages / artificialintelligenceact.eu before commitments.

## Risk classes (Regulation (EU) 2024/1689)

| Class | Examples | Consequence |
|-------|----------|-------------|
| Prohibited | Social scoring, manipulative techniques, untargeted facial scraping, most real-time remote biometric ID | Banned (applicable since Feb 2025) |
| **High-risk** | Annex III: employment screening, education scoring, essential services eligibility (public benefits!), law enforcement, justice, critical infrastructure safety; Annex I: AI in regulated products | Full compliance regime (below) |
| Limited risk / transparency | Chatbots, emotion recognition, deepfakes/AI-generated content | Disclosure/labelling duties |
| Minimal | Spam filters, game AI, most internal tooling | No new obligations |
| **GPAI models** | Foundation/general-purpose models | Separate provider regime (below) |

## Timeline (June 2026 state — note the Omnibus)

- In force 1 Aug 2024. Prohibitions + AI literacy: applicable since
  **2 Feb 2025**.
- **GPAI obligations: applicable since 2 Aug 2025** (new models;
  pre-existing models have until 2 Aug 2027). GPAI Code of Practice
  finalised 10 Jul 2025.
- **2 Aug 2026**: most remaining provisions incl. transparency
  (labelling AI-generated content) and full AI Office enforcement
  powers.
- **Digital Omnibus (provisionally agreed, pending formal adoption
  expected before Aug 2026): high-risk obligations POSTPONED — Annex
  III systems to 2 Dec 2027; Annex I embedded to 2 Aug 2028.** Until
  formally published this is provisional — say so when advising.

## Provider vs deployer (know which you are per project)

**Provider** = develops/places the system on the market under own
name. **Deployer** = uses it professionally. A consultancy building a
custom AI system for a client is typically the provider (or the
client becomes one) — substantial modification of an existing system
can transfer provider duties. Flag this determination to legal; build
to the stricter reading when ambiguous.

## High-risk system obligations (engineering view)

Risk management system (lifecycle-long, documented); data governance
(training/validation data quality, bias examination — overlaps
`gdpr.md` DPIA); **technical documentation** (Annex IV: architecture,
data, metrics, limits) maintained BEFORE market placement; **logging
by design** (automatic event recording for traceability); human
oversight designed in (not bolted on); accuracy/robustness/
cybersecurity (adversarial inputs, model poisoning — STRIDE the ML
pipeline via `threat-modelling.md`); conformity assessment + CE
marking + EU database registration; post-market monitoring and
serious-incident reporting. Deployers of high-risk systems also face
fundamental-rights impact assessments — relevant to regulated ICT
work.

## Transparency duties (apply broadly from Aug 2026)

Users told they're interacting with AI (chatbots/agents — relevant to
every Copilot Studio deployment in scope); AI-generated/manipulated
content machine-readably marked; emotion recognition/biometric
categorisation disclosed. Cheap to design in, embarrassing to
retrofit.

## GPAI-relevant points for builders ON foundation models

Using a GPAI via API (Azure OpenAI etc.) doesn't make you the model
provider — but your SYSTEM can still be high-risk by use case.
Fine-tuning may create provider-like duties at the model layer —
take legal advice past trivial cases. Document upstream model
choices, versions and the provider's documentation in your Annex IV
pack.

## Practical checklist for AI features

1. Classify the use case (prohibited? Annex III? transparency-only?).
2. Record provider/deployer roles per party in the SoW.
3. Design in: logging, human oversight points, content labelling,
   model/data documentation, eval + adversarial testing
   (prompt injection → `input-output-crypto.md` LLM sink rules).
4. Overlay GDPR (lawful basis for training/inference data, DPIA) —
   the two regimes apply simultaneously.
5. Date-check the timeline before promising compliance dates —
   the Omnibus moved them once already.
