# Liquid in Power Pages

Liquid is rendered **server-side**; output reaches the browser as plain
HTML. It can live in page Copy, content snippets, and — most importantly —
web templates. Liquid only sees data the site allows: `entities`,
`fetchxml`, and list/form objects all enforce table permissions.

## Objects (the ones that matter)

| Object | Use |
| --- | --- |
| `page` | Current page: `page.title`, `page.adx_copy`, breadcrumbs, underlying record attributes |
| `user` | Current contact; null when anonymous. `{% if user %}` is the auth check |
| `request` | `request.params['id']`, `request.path`, `request.url` — **escape everything you render** |
| `params` | Shortcut for `request.params` |
| `entities` | Load any table record by ID: `{% assign a = entities.account['<guid>'] %}` (table-permission checked) |
| `settings` | Site settings by name: `{{ settings['MySetting'] }}` |
| `snippets` | Content snippets: `{{ snippets['Header'] | default: 'fallback' }}` |
| `sitemarkers` | Stable page references: `{{ sitemarkers['Home'].url }}` — never hard-code page URLs |
| `weblinks` | Web link sets for navigation |
| `entitylist` / `entityview` | Render list data in custom templates |
| `searchindex` | Site search queries |
| `website` | The website record |
| `now` | UTC render time — **cached**, not wall-clock per request |

Attribute access: `{{ page.title }}` or dynamic `{{ object[attr_name] }}`.

Pitfalls:

- `request.url` is **cached** for subsequent requests. For per-request
  values in cached templates (header/footer), use the `{% substitution %}`
  tag, partial URLs (`~/path`), or a site setting holding the base URL.
- `user` and `request` are auto-escaped since 9.3.8.x; everything else
  (entity attributes, params already extracted into variables) still needs
  `| escape`.

## Tags

- `{% include 'Template Name' param:value %}` — composition; included
  template sees parent variables plus passed params.
- `{% extends 'Layout' %}` + `{% block name %}` — inheritance; `extends`
  must be the **first content** in the template.
- `{% assign %}`, `{% if/unless/case %}`, `{% for %}` — standard Liquid.
  Whitespace control with `{%- -%}`.
- `{% comment %}` / `{% raw %}` — suppress rendering/parsing.
- `{% substitution %}` — exclude a fragment from header/footer output
  caching (per-request rendering inside cached templates).

### fetchxml tag

```liquid
{% fetchxml result %}
<fetch count="10" returntotalrecordcount="true">
  <entity name="contact">
    <attribute name="fullname"></attribute>
    <filter type="and">
      <condition attribute="statecode" operator="eq" value="0"></condition>
    </filter>
  </entity>
</fetch>
{% endfetchxml %}
{% for c in result.results.entities %}
  <li>{{ c.fullname | escape }}</li>
{% endfor %}
```

- **No self-closing XML tags** — `<attribute name="x"/>` fails; write
  `<attribute name="x"></attribute>`.
- `result.results` exposes `entities`, `MoreRecords`, `PagingCookie`,
  `TotalRecordCount` (needs `returntotalrecordcount="true"`),
  `TotalRecordCountLimitExceeded`.
- `result.xml` shows the executed query with table permissions applied —
  the debugging tool for "why is my fetch empty".
- Results are table-permission filtered; an empty result for a working
  query usually means a missing permission, not missing data.

## Filters (beyond standard Liquid)

- `| escape` — HTML-encode; the default XSS defence.
- `| has_role: 'Administrators'` — on `user`; UX-only check, never the
  security boundary.
- `| default: 'value'` — fallback for null (snippets, settings).
- `| h` — HTML representation of an attribute (e.g. `result.xml | h`).
- `| liquid` — render a string as Liquid. Content-author input only;
  never user input.
- `| file_size`, date filters, URL filters (`add_query`) as per docs.

## Web templates

Site metadata records: **Name** (how `include`/`extends` reference it),
**Source** (the Liquid), **MIME Type** (default `text/html`; set e.g.
`application/json` when the template is bound to a page template that
controls the entire response — the standard trick for JSON endpoints
rendered by Liquid).

Built-ins worth reusing instead of rebuilding: `page_copy`, `page_header`,
`snippet`, `search`, `top_navigation`, `side_navigation`,
`weblink_list_group`, `poll`. Custom headers/footers are set on the
website record (Header/Footer Template fields); enable
`Header/OutputCache/Enabled` + `Footer/OutputCache/Enabled` site settings
and use `{% substitution %}` for dynamic fragments (see alm-deployment.md
for cache behaviour).

Web templates as components (preview): templates can declare manifest
parameters so makers configure instances in design studio.

Docs: https://learn.microsoft.com/power-pages/configure/liquid/liquid-objects ·
https://learn.microsoft.com/power-pages/configure/liquid/template-tags ·
https://learn.microsoft.com/power-pages/configure/liquid/liquid-filters ·
https://learn.microsoft.com/power-pages/configure/web-templates
