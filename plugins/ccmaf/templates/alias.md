---
description: Alias for the {{plugin}}:{{command}} plugin command (CCMAF v2 scaffold)
---
This project aliases /{{command}} to a plugin command. Invoke the
`{{plugin}}:{{command}}` plugin command via the Skill tool (skill name
`{{plugin}}:{{command}}`) and follow its instructions exactly. If the skill
does not resolve, tell the user to type `/{{plugin}}:{{command}}` directly
and to check that the {{plugin}} plugin is installed
(`claude plugin install {{plugin}}@ccmaf --scope user`).
