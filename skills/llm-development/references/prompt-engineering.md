# Prompt engineering as engineering

A prompt is a versioned artefact with tests, not a chat message. Changes
go through the same loop as code: hypothesis → edit → eval run → compare.

## Structure

Order sections by stability (cache-friendly) and put instructions before
data:

1. Role and task definition (stable) — in `system`.
2. Rules and constraints, including what to do when uncertain.
3. Few-shot examples (stable).
4. Retrieved/contextual data — clearly delimited.
5. The actual request (volatile, last).

Delimit anything injected with XML-style tags the instructions can refer
to:

```text
Extract all contractual obligations from the document.

<document>
{document_text}
</document>

Rules:
- Output JSON matching the schema in <schema>.
- If no obligations are found, output {"obligations": []}.
- Quote the source sentence for each obligation in a "source" field.
```

Tags beat markdown fences for injected content because they name the
content's role and survive nested fences. Never interpolate user input
into the *instruction* sections.

## Techniques that earn their tokens

| Technique | Use when | Notes |
|---|---|---|
| Few-shot examples | Format or judgement is hard to describe | 2–5 diverse examples incl. an edge case; examples dominate instructions when they conflict |
| Chain of thought | Multi-step reasoning, maths, analysis | "Think step by step in <thinking> tags, then answer in <answer> tags" — parse only <answer>. Redundant when API-level thinking is on |
| Output skeleton | Strict formats | Show the exact output shape, or better, enforce via structured outputs/tool schema |
| Explicit uncertainty path | Extraction/Q&A | Tell it what to do when the answer isn't present — the single best hallucination reducer |
| Prefill (assistant turn start) | Steering older models' format | Not supported on newest tier (Fable 5) — prefer structured outputs |

Anti-patterns: politeness padding and repeated emphasis (burns tokens, no
lift); "do not hallucinate" (give the uncertainty path instead); ALL CAPS
THREATS; ten instructions where three would do — instruction-following
degrades with rule count, so prioritise and group.

## Templates as code

```python
# prompts/extract_obligations.py
TEMPLATE_VERSION = "2026-06-13.2"   # stamped into logs with every call

def build(document_text: str, schema: str) -> list[dict]:
    return [{
        "role": "user",
        "content": [
            {"type": "text", "text": STABLE_INSTRUCTIONS,
             "cache_control": {"type": "ephemeral"}},
            {"type": "text",
             "text": f"<schema>\n{schema}\n</schema>\n\n"
                     f"<document>\n{document_text}\n</document>"},
        ],
    }]
```

- One module per template; no inline f-string prompts scattered through
  business logic.
- Version identifier logged with every request — production behaviour is
  attributable to a template version.
- Variables validated before injection (length budgets, stripping of
  control tokens).
- Per-model variants where behaviour diverges; a prompt tuned on one
  model is a hypothesis on another (and tokenisers differ — re-check
  budgets when changing tier).

## Eval-driven iteration

1. Collect failure cases into the golden set *before* touching the prompt.
2. Change one thing per iteration; keep a changelog of why.
3. Run the full eval set, not just the failing case — prompt edits are
   global, regressions love the cases you didn't look at.
4. Accept only on statistically meaningful improvement (see
   `evals.md` for variance handling).
5. Long prompts rot: periodically re-test whether each rule still earns
   its place — models improve, and instructions written for last year's
   model can now be dead weight or actively harmful.

## Briefing an agentic / coding task

Distinct from prompting inside an application: when the "prompt" is a task you
hand an autonomous coding agent (Claude Code, CCMAF), structure it like a
mini-spec, not a wish. Front-loading this cuts iterations and rework — the same
discipline as a well-written ticket.

- **Intent** — classify the work: feature / fix / refactor / investigation. It
  sets the agent's strategy and risk posture (a refactor must preserve
  behaviour; an investigation shouldn't change code).
- **Acceptance criteria** — explicit, checkable "done" conditions. The agent
  self-verifies against them, and you can tell when it's actually finished.
- **Scope boundaries** — what's in, and what's explicitly *out*, so the work
  doesn't sprawl into unrequested changes.
- **Context up front** — the files, constraints, conventions and prior
  decisions it needs; don't make it guess or rediscover what you already know.
- **Gap analysis first** — ask it to surface missing information or ambiguity
  *before* implementing, not after it's built the wrong thing.

The portable lesson: vague intent in, expensive iteration out. (The rest of
this file covers engineering prompts *inside* an application; this is about
instructing an agent to do work.)

## System prompt discipline for agents

- The system prompt is the contract: identity, capabilities, hard rules,
  escalation behaviour. Keep it byte-stable within a session (cache; and
  mid-session edits change agent behaviour untestably).
- Put environment-specific facts (today's date, user identity, mounted
  paths) in one clearly marked late block, not woven through the prose.
- Adapt upstream "ask the user" guidance for autonomous agents:
  decide-and-flag with stated assumptions, reserving questions for
  genuinely blocking forks.
