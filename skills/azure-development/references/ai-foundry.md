# Azure AI Foundry

Microsoft's platform for models, agents, and AI app lifecycle —
formerly "Azure AI Studio"; Azure OpenAI deployments now live under it.
Grounded in microsoft/skills' microsoft-foundry skill (official,
deep — install it for hands-on Foundry automation; this file is the
working map).

## Resource model

**Foundry resource** (an AI Services multi-service account) →
**project(s)** on it → **model deployments**, **agents**, evaluation
assets. Provisioning choices: bare resource (granular control), public
project (default onboarding), or **VNet-isolated** (BYO VNet / managed
VNet) for enterprise — network isolation is a first-class deployment
template choice, not a retrofit.

## Models

- Deployment = model + version + SKU + capacity (TPM) + RAI policy in a
  region. **Check quota/capacity across regions before committing** —
  capacity varies by region/SKU and deployment failures are usually
  quota, not configuration.
- SKUs: Standard (regional), Global Standard (routing for higher
  availability), Provisioned (PTU — reserved throughput for
  production-steady loads). Match billing shape to traffic.
- RBAC for Foundry has its own role set; CI/CD uses service principals
  with project-scoped roles.

## Agents

Lifecycle per the official skill: **create** (Agent Framework,
LangGraph, or custom — Python/C#) → **deploy** (container → ACR →
hosted agent) → **invoke** (single/multi-turn; WebSocket protocol for
voice/real-time) → **observe** (batch + continuous evaluation, prompt
optimisation) → **trace/troubleshoot** (App Insights customEvents,
hosted logs). Hosted agents carry an `agent.yaml`/`.foundry/` workspace
convention; azd projects derive endpoints/ACR/App Insights from
`azure.yaml` + `azd env`.

## Evaluation is not optional

Production agents get: a baseline eval suite (datasets curated from
real traces), batch evals on change, **continuous evaluation** on live
traffic, and regression tracking across dataset versions. "It answered
my test prompt" is not an evaluation. Fine-tuning (SFT distillation,
DPO, RFT with graders) sits behind the same eval discipline — calibrate
graders before trusting them.

## Integration into solutions

- Apps call deployed models via the OpenAI-compatible endpoint with
  **managed identity** (Cognitive Services OpenAI User role) — no keys
  in app settings.
- RAG: Azure AI Search (vector + semantic hybrid) as the retrieval
  layer; index freshness and chunking strategy decide answer quality
  more than the model choice.
- Content safety / RAI policies apply per deployment; log prompts and
  completions (App Insights) within data-handling rules — relevant for
  regulated clients.
- Cost: tokens are the unit; cache aggressively, cap max tokens, use
  small models where evals say they suffice — model right-sizing is the
  AI cost lever.

Docs: https://learn.microsoft.com/azure/ai-foundry/ ·
https://learn.microsoft.com/azure/ai-foundry/agents/ ·
https://learn.microsoft.com/azure/ai-foundry/openai/ ·
(plus microsoft/skills microsoft-foundry skill and sub-skills)
