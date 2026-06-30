# Writing Custom Nodes

A custom node is a Python class ComfyUI discovers at startup. As of 2026
there are **two schemas**: V3 (recommended for new nodes) and V1 (the
"legacy protocol", still fully supported and used by almost every
existing node). Know both — you'll write V3 and maintain V1.

A node, in either schema, declares: its **inputs** (typed, with
required/optional/hidden), its **return types**, the **function** to run,
a **category** for the menu, and is **registered** so ComfyUI finds it.
Restart ComfyUI after changing registration.

## V1 (legacy protocol) — read-and-maintain, still valid

```python
class InvertImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0,
                                       "max": 1.0, "step": 0.01}),
            },
            "optional": {"mask": ("MASK",)},
            "hidden": {"prompt": "PROMPT"},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"
    CATEGORY = "image/postprocess"
    # OUTPUT_NODE = True   # set on terminal nodes that save/preview

    def run(self, image, strength, mask=None, prompt=None):
        return (1.0 - image * strength,)   # tensors; return a TUPLE

    @classmethod
    def IS_CHANGED(cls, image, strength, **kw):
        return strength    # change signal → controls re-execution/caching

NODE_CLASS_MAPPINGS = {"InvertImage": InvertImage}
NODE_DISPLAY_NAME_MAPPINGS = {"InvertImage": "Invert Image"}
```

Key rules: inputs are `(TYPE, options_dict)` tuples; `FUNCTION` names the
method; the method **returns a tuple** matching `RETURN_TYPES` (a common
bug is returning a bare value). `OUTPUT_NODE = True` marks terminal nodes
(save/preview) so they always run. `IS_CHANGED` lets you bust the cache
(e.g. for nodes reading external state).

## V3 schema — recommended for new nodes

V3 is object-oriented and type-safe (dynamic inputs, better IDE/typing).
The shape: subclass `io.ComfyNode`, return an `io.Schema` from
`define_schema`, return an `io.NodeOutput` from `execute`, and export via
an async `comfy_entrypoint()` instead of `NODE_CLASS_MAPPINGS`. Use
versioned imports so the API is stable.

```python
from comfy_api.latest import io   # or pin: from comfy_api.v0_0_3 import io

class InvertImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="InvertImage",
            display_name="Invert Image",
            category="image/postprocess",
            inputs=[
                io.Image.Input("image"),
                io.Float.Input("strength", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, strength) -> io.NodeOutput:
        return io.NodeOutput(1.0 - image * strength)

async def comfy_entrypoint():
    return [InvertImage]
```

The exact `io.*` surface evolves — **verify against
docs.comfy.org/custom-nodes/v3_migration** for the current field names
before relying on specifics; treat the above as the structural shape, not
a frozen API.

## Node types you'll meet

Inputs/outputs use ComfyUI's type strings — `IMAGE`, `MASK`, `LATENT`,
`MODEL`, `CLIP`, `VAE`, `CONDITIONING`, plus `INT`/`FLOAT`/`STRING`/
`BOOLEAN` and combo (a list = a dropdown). `IMAGE` tensors are
`[B,H,W,C]` float 0–1; `MASK` is `[B,H,W]`. Match these exactly or the
graph won't connect.

## Frontend (JS) extensions

UI behaviour (custom widgets, previews) lives in JavaScript registered
via `app.registerExtension(...)`, served from a folder pointed to by
`WEB_DIRECTORY = "./web"` (V1) or the V3 equivalent. The Nodes 2.0 (Vue)
frontend changed parts of this — verify against current docs if building
rich UI.

## Packaging and publishing

Modern custom nodes are a repo with `__init__.py` exporting the mappings/
entrypoint and a `pyproject.toml` carrying a `[tool.comfy]` section
(metadata for the Comfy Registry). Publish with `comfy-cli`
(`comfy node publish`) to registry.comfy.org so it's installable via
ComfyUI-Manager. Pin dependencies; remember installers run your code on
users' machines — keep it clean and declare requirements honestly
(`secure-development`).

General Python packaging/testing → `python-development`.
