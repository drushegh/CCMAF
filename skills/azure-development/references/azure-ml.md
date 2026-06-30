# Azure Machine Learning

Azure Machine Learning (AML) is the platform for **training, registering and
operationalising your own models** with an MLOps lifecycle. This reference is
decision/discipline level; classic ML coding (scikit-learn/pandas, model code)
→ `python-development`. For generative AI, GPT models, agents and prompt
flow/RAG, use `references/ai-foundry.md` — see the boundary below.

## Workspace and assets

The **workspace** is the top-level resource and the central registry for
assets: data, environments, components, jobs, models and endpoints. Version
everything (data, environments, models) — reproducibility is the point.
Use SDK v2 (`azure-ai-ml`, `MLClient`) or CLI v2 (`az ml` extension); both are
the current generation (v1 is legacy).

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

ml_client = MLClient(DefaultAzureCredential(), subscription_id, resource_group, workspace)
```

Authenticate with `DefaultAzureCredential` / managed identity and RBAC — never
embedded credentials. Connect the workspace to Key Vault, Storage and
Application Insights (created with it).

## Compute

- **Compute clusters** (`AmlCompute`) for training/batch — autoscale with
  `min_instances=0` so idle clusters cost nothing.
- **Compute instances** for interactive development (stop when idle).
- Right-size the VM SKU to the job; GPU only where the workload needs it.

## MLflow is the standard

AML uses **MLflow** for experiment tracking and as the model packaging format.
A model logged as an MLflow model deploys to AML endpoints **without** a custom
scoring script or environment. Track runs with MLflow; register the resulting
model — **only registered models can be deployed**.

## Endpoints — online vs batch

| | Managed online endpoint | Batch endpoint |
|---|---|---|
| Use | Real-time, low-latency inference | Large-volume async scoring |
| Scale | Instance type + count; traffic split | Compute cluster, parallelised across nodes |
| Deploy | Blue/green via traffic % across deployments | Model deployment or pipeline-component deployment |

```python
from azure.ai.ml.entities import ManagedOnlineDeployment

deployment = ManagedOnlineDeployment(
    name="blue", endpoint_name=endpoint_name, model=model,
    instance_type="Standard_F4s_v2", instance_count=1,
)
ml_client.online_deployments.begin_create_or_update(deployment)
```

Shift traffic gradually (e.g. 10% → 100%) for safe rollout; an endpoint hosts
multiple deployments behind one stable scoring URI.

## MLOps discipline

- **Pipelines and reusable components** for repeatable training; don't hand-run
  notebooks into production.
- Promote registered models across environments with **registries**
  (cross-workspace sharing of models/components/environments).
- CI/CD for training and deployment → `devops-development`; data prep at scale
  → `fabric-development` / `sql-development`.
- Use the **Responsible AI** dashboard (fairness, error analysis,
  interpretability) where decisions affect people — relevant to regulatory
  obligations (EU AI Act → `secure-development`).

## Boundary: Azure ML vs AI Foundry

- **Azure ML** — you train/fine-tune/operationalise *your own* models (classic
  ML, custom DL, MLOps). 
- **AI Foundry** (`ai-foundry.md`) — you consume/orchestrate *foundation*
  models (GPT etc.), build agents, prompt flow, RAG, evals.

They overlap (Foundry builds on AML concepts); pick by whether the work is
"my model lifecycle" (AML) or "build on a hosted foundation model" (Foundry).
