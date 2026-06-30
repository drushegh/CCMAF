# Client Scripting (Model-Driven Apps)

JavaScript web resources against the documented **Client API** only —
DOM manipulation and undocumented objects break on platform updates and
fail support reviews.

## formContext — never Xrm.Page

`Xrm.Page` is deprecated. Every handler receives `executionContext`;
derive `formContext` from it:

```javascript
"use strict";
var ContosoAccount = ContosoAccount || {};

ContosoAccount.onLoad = function (executionContext) {
    var formContext = executionContext.getFormContext();

    // attributes = data; controls = presentation
    var category = formContext.getAttribute("contoso_category");
    var phoneControl = formContext.getControl("telephone1");

    if (category && category.getValue() === 100000001) {
        phoneControl.setVisible(true);
        formContext.getAttribute("telephone1").setRequiredLevel("required");
    }
};

ContosoAccount.onCategoryChange = function (executionContext) {
    var formContext = executionContext.getFormContext();
    // ...
};
```

Namespace everything (`Publisher.Entity.handler`) — globals collide
across web resources. Register handlers in form properties (or
preferably via form XML in the solution), tick **"Pass execution context
as first parameter"**, and pass the function name without parentheses.

## The Object Model

```text
formContext
├── data
│   ├── entity        // getId(), getEntityName(), attributes, save()
│   ├── attributes    // getValue/setValue, getRequiredLevel, addOnChange
│   └── process       // business process flow data
└── ui
    ├── controls      // setVisible, setDisabled, setNotification, addNotification
    ├── tabs/sections // navigation + visibility
    ├── formSelector  // switch forms
    └── setFormNotification(message, level, uniqueId)
```

Key distinction: an **attribute** (value, requirement, change events) can
be bound to multiple **controls** (visibility, enabled, notifications).
To act on all controls of a column:

```javascript
formContext.getAttribute("name").controls.forEach(function (control) {
    control.addNotification({
        messages: ["Check this value"],
        notificationLevel: "RECOMMENDATION",
        uniqueId: "contoso_name_check"
    });
});
```

## Common Patterns

```javascript
// Conditional visibility + requirement (the bread-and-butter)
var value = formContext.getAttribute("contoso_type").getValue();
formContext.getControl("contoso_detail").setVisible(value !== null);
formContext.getAttribute("contoso_detail")
    .setRequiredLevel(value !== null ? "required" : "none");
// NOTE: hiding a control bound to a Business Required column removes the
// save-time requirement — hide + requirement must be managed together.

// Field notification (blocks save until cleared)
formContext.getControl("creditlimit").setNotification("Exceeds approval threshold", "contoso_credit");
formContext.getControl("creditlimit").clearNotification("contoso_credit");

// Async data via Web API — always handle errors
Xrm.WebApi.retrieveRecord("account", accountId, "?$select=name,creditlimit")
    .then(function (result) { /* ... */ })
    .catch(function (error) {
        formContext.ui.setFormNotification(error.message, "ERROR", "contoso_retrieve");
    });

// Lookup filtering
formContext.getControl("parentaccountid").addPreSearch(function () {
    formContext.getControl("parentaccountid")
        .addCustomFilter("<filter><condition attribute='statecode' operator='eq' value='0'/></filter>");
});
```

## Rules

- Handlers fast and async-aware — slow OnLoad is user-perceived app
  slowness; never synchronous XHR.
- Don't trust client validation alone — every rule enforced client-side
  for UX must be enforced server-side (plugin/column) for integrity.
- Web resource JS is TypeScript-authored in serious repos (typed
  `@types/xrm`), bundled per entity, added to THE solution.
- OnChange handlers fire on programmatic `setValue` only when you call
  `fireOnChange()` — be deliberate.
- Business rules cover simple show/hide/require — use them before
  writing script (declarative-first ladder).

## Web Resource vs PCF

Web resources: form event logic, light HTML embeds. **PCF** (see
pcf.md): anything presenting data as a custom control — it's properly
hosted, themed, mobile-aware, and reusable. New visual customisation
defaults to PCF; new *logic* stays in form script.
