# Azure Pipelines

## Shape

```yaml
trigger:
  branches: { include: [main, develop] }
pr:
  branches: { include: [main] }

pool:
  vmImage: 'ubuntu-22.04'   # pinned, not -latest

variables:
  - group: shared-build      # variable group (Key Vault-linked for secrets)
  - name: buildConfiguration
    value: Release

stages:
  - stage: Build
    jobs:
      - job: Build
        timeoutInMinutes: 30
        steps:
          - checkout: self
            fetchDepth: 1
          - script: dotnet build -c $(buildConfiguration)
            displayName: Build
          - publish: $(Build.ArtifactStagingDirectory)
            artifact: drop

  - stage: DeployTest
    dependsOn: Build
    jobs:
      - deployment: Deploy
        environment: test          # ADO Environment = approvals + history
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: drop
                - script: ./deploy.sh
```

- `deployment` jobs (not plain jobs) for anything that deploys — they
  bind to **Environments**, which carry approvals, checks (business
  hours, Azure Monitor alerts), and deployment history.
- Stage `dependsOn` + `condition` control flow;
  `condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))`
  is the standard prod gate alongside environment approval.

## Templates (reuse)

- **Step/job/stage templates** (`- template: build-steps.yml@templates`
  with a `repository` resource) for shared logic across repos.
- **Extends templates** for governance: the root pipeline `extends` a
  central template that controls structure; combined with **required
  template checks** on service connections/environments, teams can't
  bypass the guarded path.
- Parameters are typed (`type: string/boolean/object`) and evaluated at
  compile time vs `variables` at runtime — `${{ }}` compile-time,
  `$( )` runtime macro, `$[ ]` runtime expression; using the wrong one
  is the classic "empty variable" bug.

## Service connections and identity

ARM service connections with **workload identity federation** (no
secret to rotate); one connection per target environment, scoped to the
narrowest subscription/RG; grant pipelines access explicitly rather
than "all pipelines". Other connections (ACR, GitHub, Power Platform)
follow the same per-environment, least-scope discipline.

## Variables and secrets

Variable groups per environment; secrets via **Key Vault-linked
groups** (rotation lands automatically); secret variables are masked
and not mapped to env automatically in scripts — pass explicitly via
`env:`. Settable-at-queue-time only where genuinely needed.

## Agents

Microsoft-hosted for standard builds; **self-hosted/scale-set agents**
when builds need VNet access (private endpoints, internal feeds),
custom images, or sustained throughput. Self-hosted = your patching,
your hygiene: clean workspaces, no cred caches.

## Operational notes

- `az pipelines` / `az devops` CLI and the REST API for automation
  (queue runs, set defaults with `az devops configure`).
- Pipeline decorators/branch policies: PR build validation on main is
  the minimum bar.
- Retention: artifacts and runs are pruned by policy — pin the runs
  that matter (releases) or export artifacts to a feed/storage.
- Multi-repo checkouts via `repository` resources; pipeline-completion
  triggers (`resources.pipelines`) chain CI → CD pipelines cleanly.

Docs: https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/ ·
https://learn.microsoft.com/azure/devops/pipelines/process/templates ·
https://learn.microsoft.com/azure/devops/pipelines/library/connect-to-azure ·
https://learn.microsoft.com/azure/devops/pipelines/process/environments
