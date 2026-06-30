# Packaging: Helm and Kustomize

Don't hand-maintain near-identical YAML per environment. Template (Helm) or
overlay (Kustomize) instead.

## Helm — when you need templating and a release lifecycle

A chart packages templated manifests + default values; `helm install/upgrade`
manages a versioned **release** with rollback.

```
mychart/
  Chart.yaml          # name, version (chart), appVersion
  values.yaml         # documented defaults
  values.schema.json  # validate values (do this)
  templates/
    _helpers.tpl      # reusable label/name helpers
    deployment.yaml
    service.yaml
    NOTES.txt
```

Practices that matter:
- **SemVer** the chart; pin subchart **dependency** versions explicitly (never
  floating).
- **Document every value** in `values.yaml` and enforce a `values.schema.json`
  so bad input fails fast.
- Centralise labels/names in `_helpers.tpl`; apply the standard
  `app.kubernetes.io/*` labels everywhere.
- Use `{{- ... -}}` whitespace control; gate optional resources with
  `{{ if .Values.x }}`.
- Render and lint before shipping:

```bash
helm lint ./mychart
helm template app ./mychart -f values-prod.yaml | kubeconform -strict -
helm upgrade --install app ./mychart -f values-prod.yaml --atomic --wait
```

`--atomic` rolls back a failed upgrade; `helm rollback app N` reverts. Avoid
heavy logic and `lookup`-driven templates — charts should be reproducible.

## Kustomize — when you want plain YAML + overlays

Base manifests plus per-environment overlays (patches), no templating language.
Built into `kubectl` (`kubectl apply -k`).

```
base/                 # deployment.yaml, service.yaml, kustomization.yaml
overlays/
  staging/kustomization.yaml   # patches: replicas, image tag, env
  production/kustomization.yaml
```

Strong for image-tag/replica/config differences and GitOps repos; weaker when
you need real conditionals or distributable packages.

## Choosing

- **Helm** for redistributable apps, third-party software, and anything needing
  conditionals, a values contract, or release/rollback semantics.
- **Kustomize** for your own apps where environments differ by a few patched
  fields and you want auditable plain YAML.
- They compose: many teams render a base with Helm and patch with Kustomize, or
  let Argo CD/Flux do either. Pick one primary approach per repo and be
  consistent — don't template the same thing two ways.
