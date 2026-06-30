# Compute Shaders (GLSL via RenderingDevice)

Compute shaders in Godot are **not** Godot Shading Language — they are
raw GLSL (`#version 450`, Vulkan style) in a `.glsl` file, run through
the low-level `RenderingDevice` API. Use them for GPGPU: simulation,
image processing, procedural generation, large parallel maths — work
that produces data, not a rendered surface.

**Hard requirement:** compute needs a `RenderingDevice` backend, i.e.
the **Forward+ or Mobile** renderer. On Compatibility (OpenGL/web) there
is no `RenderingDevice` and this whole path is unavailable. Verify the
project's renderer before proposing compute.

## The shader file

```glsl
#[compute]
#version 450

layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;

layout(set = 0, binding = 0, std430) restrict buffer Data {
    float values[];
} buf;

void main() {
    uint i = gl_GlobalInvocationID.x;
    buf.values[i] = buf.values[i] * 2.0;
}
```

`#[compute]` tells Godot's importer this is a compute stage.
`local_size_*` is the workgroup size (tune to the hardware; 64 is a safe
default for 1D). Bindings map to the uniform set you build on the CPU
side. For images use `layout(..., rgba32f) uniform image2D img;` and
`imageLoad`/`imageStore`.

## Driving it from GDScript

```gdscript
var rd := RenderingServer.create_local_rendering_device()

var shader_file: RDShaderFile = load("res://compute/double.glsl")
var spirv: RDShaderSPIRV = shader_file.get_spirv()
var shader: RID = rd.shader_create_from_spirv(spirv)

var input := PackedFloat32Array([1, 2, 3, 4])
var bytes := input.to_byte_array()
var buffer: RID = rd.storage_buffer_create(bytes.size(), bytes)

var uniform := RDUniform.new()
uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
uniform.binding = 0
uniform.add_id(buffer)
var uniform_set := rd.uniform_set_create([uniform], shader, 0)

var pipeline := rd.compute_pipeline_create(shader)
var cl := rd.compute_list_begin()
rd.compute_list_bind_compute_pipeline(cl, pipeline)
rd.compute_list_bind_uniform_set(cl, uniform_set, 0)
rd.compute_list_dispatch(cl, input.size() / 64 + 1, 1, 1)  # workgroups
rd.compute_list_end()

rd.submit()
rd.sync()                                   # blocks until done

var out := rd.buffer_get_data(buffer).to_float32_array()
```

Dispatch count is in **workgroups**, not threads: total threads =
workgroups × local_size. Cover your data with
`ceil(n / local_size_x)` groups and bounds-check `gl_GlobalInvocationID`
inside the shader.

## Local vs main rendering device

- `create_local_rendering_device()` — a separate device, ideal for
  offline/background compute whose results you read back to the CPU.
  Simple, isolated, but the readback (`sync()`) stalls.
- The **main** device (`RenderingServer.get_rendering_device()`) — use
  when the compute result feeds rendering on the same GPU without a
  CPU round-trip (e.g. writing a texture a material then samples).
  Higher performance, more care needed with synchronisation.

## Pitfalls

- **`sync()` stalls the calling thread.** For per-frame compute, avoid
  read-back every frame; double-buffer or keep results GPU-side. Heavy
  one-off compute belongs on a thread.
- **Free RIDs.** `RenderingDevice` resources are manual —
  `rd.free_rid(...)` shaders, buffers, pipelines you no longer need, or
  you leak GPU memory.
- **`std430` layout and alignment.** `vec3` aligns to 16 bytes; mismatch
  between the GLSL struct and the `PackedByteArray` you upload is the
  commonest "garbage out" bug. Pad explicitly.
- **Renderer mismatch** — silent no-op on Compatibility.
- **Workgroup maths off by one** — under-dispatching leaves the tail of
  the buffer unprocessed; over-dispatching reads out of bounds unless
  guarded.

Boundary: threading the dispatch, exposing results to gameplay →
`godot-development`; browser WebGPU compute → `threejs-development`.
