# Solutions and ALM

Solutions are the unit of transport for everything custom. Unmanaged in
dev (source of truth, unpacked in git); **managed** into test/prod.

## Create

No `pac solution create` — the solution is a Dataverse record:

1. **Publisher first** (discovery flow in dataverse-operations.md — never
   `new_`).
2. Create the `solution` record: `uniquename`, `friendlyname`,
   `version` ("1.0.0.0"), `publisherid@odata.bind`.
3. Add components:

```bash
pac solution add-solution-component \
  --solutionUniqueName ContosoCore \
  --component contoso_project \
  --componentType 1 \
  --environment <url>
```

| Type code | Component | | Type code | Component |
|---|---|---|---|---|
| 1 | Table | | 60 | Form |
| 2 | Column | | 61 | Web Resource |
| 26 | View | | 300 | Canvas App |

Or auto-add at creation time with the `MSCRM.SolutionName` Web API
header — then **verify with `pac solution list-components`** (typos fail
silently into Default).

## Pull (environment → repo)

```bash
pac solution export --name ContosoCore --path ./solutions/ContosoCore.zip \
  --managed false --environment <url>
pac solution unpack --zipfile ./solutions/ContosoCore.zip \
  --folder ./solutions/ContosoCore --packagetype Unmanaged
rm ./solutions/ContosoCore.zip          # the unpacked folder is the source
git add ./solutions/ContosoCore && git commit -m "chore: pull ContosoCore"
```

## Push (repo → environment)

```bash
pac solution pack --zipfile ./solutions/ContosoCore.zip \
  --folder ./solutions/ContosoCore --packagetype Unmanaged
pac solution import --path ./solutions/ContosoCore.zip \
  --environment <url> --async --activate-plugins
```

`--async` for anything sizeable (first-party apps take 10–20 min — poll,
don't re-import); `--activate-plugins` or imported steps arrive
disabled; `--import-mode ForceUpgrade` for already-exists conflicts.
Managed exports (`--managed true`) for downstream promotion — in
pipelines, build managed from the unmanaged source.

## Post-Import Validation — import success ≠ working system

Verify, minimally:

- Components present: `pac solution list-components`.
- Tables resolvable, forms published (publishing is async — a check 5
  seconds after import legitimately fails; wait/retry), views present.
- Plugin steps activated.
- Import job state: query `importjob` (progress) and
  `msdyn_solutionhistory` (status 1 = failed, with exception message)
  when anything looks off.

| Symptom | Cause | Fix |
|---|---|---|
| Table missing after import | Not in the solution | add-solution-component, re-export |
| Form check fails immediately | Async publishing | wait 30s, retry |
| Import stuck at 0% | Still running | poll at 60s intervals |
| "Solution already exists" | Version conflict | `--import-mode ForceUpgrade` |

## Security Roles (deployment-adjacent)

Role grants change security posture and are audit-logged — **preview in
prose and confirm before running** (target user, role, environment):

```bash
pac admin assign-user --user user@contoso.com \
  --role "System Administrator" --environment <url>
# service principals: add --application-user
```

App users (service principals) for integrations get purpose-built
roles, never System Administrator by default.

## Pipeline Shape (CI/CD)

Dev export/unpack committed → PR → build packs + builds plugin
assemblies → managed solution artefact → import to test (service
principal auth, `pac auth create --applicationId ...`) → validation
checks → approved promotion to prod. Environment URLs and credentials
live in pipeline variables/key vault, never in the repo. (Pipeline
tooling itself: the devops-development skill when it lands.)
