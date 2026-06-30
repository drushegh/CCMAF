# Basic Forms, Multistep Forms, Lists

The classic metadata-driven data surfaces. All of them render Dataverse
model-driven forms/views and enforce table permissions. Configure simple
cases in design studio; the **Portal Management app** (adx_/mspp_ records)
holds the advanced options.

## Basic forms (entity forms)

A webpage component bound to a model-driven form: Insert / Edit /
ReadOnly modes, record source from query string (`id` parameter by
default). Advanced behaviour lives in **basic form metadata** records:
relabel sections/tabs, prepopulate/set values on save, validation
overrides, OOB subgrid and notes configuration.

- Mark rollup or computed columns **read-only on the model-driven form** —
  they can otherwise render editable and silently discard input.
- "On success" redirect options beat custom JS redirects — they survive
  postbacks.

## Multistep forms (advanced forms / web forms)

A container of **steps** (each step ≈ a basic form bound to a form/tab),
with session tracking so users can resume.

- **Steps cannot be reused** within or across multistep forms (exceptions:
  "next step if condition fails" targets and Yes/No condition branches).
  Clone the step instead.
- Step types: Load Form / Load Tab, Condition (branching), Redirect.
- Metadata records per step give the same relabel/prepopulate/validation
  control as basic form metadata.

## Form JavaScript

Both basic forms and multistep form steps have a **Custom JavaScript**
field, injected at the bottom of the page before the closing form tag.
jQuery is available; field inputs use the **attribute logical name** as
HTML id:

```javascript
$(document).ready(function () {
  $("#address1_stateorprovince").val("Saskatchewan");

  // conditional requirement pattern
  if (typeof Page_Validators === "undefined") return;
  var v = document.createElement("span");
  v.style.display = "none";
  v.id = "emailRequiredValidator";
  v.controltovalidate = "emailaddress1";
  v.errormessage = "<a href='#emailaddress1_label'>Email is required.</a>";
  v.evaluationfunction = function () {
    var preferred = $("#preferredcontactmethodcode").val();
    return preferred !== "2" || $("#emailaddress1").val() !== "";
  };
  Page_Validators.push(v);
});
```

- Submit/Next runs `entityFormClientValidate` — extend it for cross-field
  rules.
- Client-side validation is **not supported in subgrids**.
- Never inject extra options into a choice (option set) control —
  submission fails with "Invalid postback or callback argument".
- Client JS is convenience, not validation of record: anything mandatory
  must also be enforced in Dataverse (business rules, plug-ins).

## Client API (preview)

A supported object model is replacing raw DOM/jQuery poking:

```javascript
let $pages = await Microsoft.Dynamic365.Portal.onPagesClientApiReady();
let form = $pages.currentPage.forms.getFormByName('form_name');
form.tabs[0].setVisible(false);
if (form.isMultiStep && form.hasNextStep) form.goToNextStep();
```

Forms expose `controls`, `tabs` (→ `sections`), visibility get/set;
multistep adds `goToNextStep`/`goToPreviousStep`. Prefer it over
hand-rolled selectors where available; it's preview, so keep fallbacks
testable.

## Lists (entity lists)

Render a Dataverse **view** with search, filtering, paging, map/calendar
options, and actions (details/edit/delete/workflow/download). Pair with a
details basic form via the configured Record ID parameter (`id`). Lists
respect table permissions — an unexpectedly empty list is almost always a
permission/scope issue. For fully custom rendering, query the `entitylist`
/ `entityview` Liquid objects or the Web API instead.

- **Enhanced view filter**: put a dummy contact/account condition in the
  underlying Dataverse view; at runtime conditions with
  `uitype="contact"` / `"account"` / `"adx_website"` are replaced with the
  signed-in user's IDs — contextual filtering without code. Pair with a
  page permission forcing sign-in.
- `EntityList/ShowRecordLevelActions = true` shows only the actions the
  user's permissions actually allow per row.
- Searchable large text columns kill list performance — exclude them.

Docs: https://learn.microsoft.com/power-pages/configure/basic-forms ·
https://learn.microsoft.com/power-pages/configure/multistep-form-properties ·
https://learn.microsoft.com/power-pages/configure/add-custom-javascript ·
https://learn.microsoft.com/power-pages/configure/client-api ·
https://learn.microsoft.com/power-pages/configure/lists
