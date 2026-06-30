# Programmatic Runs: HTTP + WebSocket API

ComfyUI exposes an aiohttp HTTP API plus a WebSocket for progress. This
is how you generate from code, batch, or wrap ComfyUI behind a service.
**No auth by default** — keep it local/private (`mcp-and-deployment.md`).

## Endpoints you'll actually use

| Endpoint | Purpose |
|----------|---------|
| `POST /prompt` | queue an **API-format** workflow (`{prompt, client_id}`); returns a `prompt_id` |
| `GET /history/{prompt_id}` | results for a finished prompt (output filenames per node) |
| `GET /view?filename=&subfolder=&type=output` | fetch an output image/file |
| `POST /upload/image` | upload an input image (for img2img/inpaint) |
| `GET /object_info` | schema of every available node (types, inputs, defaults) — discovery |
| `WS /ws?clientId=` | live execution messages |
| `GET /queue`, `POST /interrupt`, `POST /queue` (clear/delete) | queue control |

## The standard client pattern

1. Generate (or reuse) a `client_id` (UUID).
2. Open the WebSocket `ws://host:port/ws?clientId=<id>`.
3. POST the API-format workflow to `/prompt` with that `client_id`;
   capture `prompt_id`.
4. Read WS messages until done, then pull results from `/history` and
   files from `/view`.

```python
import json, urllib.request, uuid, websocket  # websocket-client

HOST, cid = "127.0.0.1:8188", str(uuid.uuid4())

def queue(workflow):                      # workflow = API-format dict
    body = json.dumps({"prompt": workflow, "client_id": cid}).encode()
    req = urllib.request.Request(f"http://{HOST}/prompt", data=body)
    return json.loads(urllib.request.urlopen(req).read())["prompt_id"]

ws = websocket.WebSocket(); ws.connect(f"ws://{HOST}/ws?clientId={cid}")
pid = queue(api_workflow)
while True:
    msg = ws.recv()
    if isinstance(msg, str):
        m = json.loads(msg)
        if m["type"] == "executing" and m["data"]["node"] is None \
           and m["data"]["prompt_id"] == pid:
            break                          # this prompt finished
hist = json.loads(urllib.request.urlopen(f"http://{HOST}/history/{pid}").read())
```

## WebSocket message types

- `status` — queue length.
- `execution_start` / `executing` (`node: null` = that prompt done).
- `progress` — sampler step progress (current/total) for progress bars.
- `executed` — a node produced outputs (filenames in `data.output`).
- `execution_error` / `execution_cached` — failures and cache hits.

Binary WS frames carry live preview images when previews are enabled.

## Parameterising and batching

Load the API-format JSON once and mutate fields by node ID before
queueing — that's the whole trick to data-driven generation:

```python
wf = json.load(open("workflow_api.json"))
wf["6"]["inputs"]["text"] = prompt_text        # positive CLIP node
wf["3"]["inputs"]["seed"] = seed               # KSampler
wf["5"]["inputs"]["width"] = 1024
```

- Find node IDs from the exported JSON or `/object_info`. Don't hard-code
  IDs blindly — they're stable per exported workflow but differ between
  workflows.
- Batch by queueing many prompts (ComfyUI serialises the queue) or
  varying the batch_size on the latent for one call.
- For uploads, `POST /upload/image` first, then reference the returned
  filename in a `LoadImage` node's inputs.
- Wrapping this as agent tools / MCP → `mcp-and-deployment.md`; building
  the MCP server itself → `llm-development`.
