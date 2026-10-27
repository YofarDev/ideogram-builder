# MOSS-Image inference optimization research

Research date: 27 October 2026. Target: this project's native ComfyUI workflow on Modal, with an RTX PRO 6000 (96 GB), confirmed by the user.

The strongest opportunities are checking the PyTorch/CUDA kernel path, benchmarking GPU residency and precision, adding a separate four-step preset, and evaluating Spectrum on the existing longer presets. The gains below are published results or hypotheses to test, not measurements of this deployment.

## Current implementation

Local files reviewed: `runpod/Dockerfile.moss`, `runpod/workflow_template_moss.json`, `runpod/handler.py`, and `runpod/modal_app.py`.

| Component | Current configuration |
| --- | --- |
| Image | `runpod/worker-comfyui:5.8.5-base` |
| ComfyUI | Pinned to `7cebca52227c63b4180ceed448cbd7ad22903b6d`, dated 24 October |
| Diffusion model | `moss_image_sft_int8_convrot.safetensors` |
| Text encoder | `qwen3.5_9b_w4a8_gptq.safetensors` |
| Decoder | `flux2-vae_small.safetensors` |
| Fast | 25 steps, CFG 2.5, `er_sde` / `simple`, simple SLG on layer 22 over 0–0.5 |
| Quality | 50 steps, CFG 3, `euler` / `simple`, simple SLG over 0–1 |
| Turbo | 8 steps, CFG 1, `euler` / `simple`, lodestones DMD LoRA, no SLG |
| Process | One persistent ComfyUI subprocess per GPU worker; previews disabled |
| Worker lifetime | `min_containers=0`, `scaledown_window=300` |

The Fast preset closely matches the [Comfy-Org native template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_moss_image_t2i.json). Native support is already present; installing the older HF-directory loader plugin is unnecessary. The [OpenMOSS integration guide](https://github.com/OpenMOSS/MOSS-Image/blob/main/comfyui/README.md) also warns that plugin and native timestep conventions differ.

Turbo already uses the major eight-step optimization. The [lodestones model card](https://huggingface.co/lodestones/MOSS-Image-SFT-8-steps-dmd) currently recommends its ordinary LoRA file at strength 1, matching this project's loader. Its older data-space instructions are explicitly deprecated. Instructions for archived adapters must not be mixed with current releases.

## 1. Check the optimized CUDA path first

This is the most concrete configuration concern found in the source review:

- The [base image's published Docker layers](https://hub.docker.com/layers/runpod/worker-comfyui/5.8.5-base/images/sha256-7684477263fb79a625b32adb2ac4fbb50e45fb9eaeea50aa20d443355e78a92c) show CUDA 12.6.3 and installation targeting CUDA 12.6. The [tagged Dockerfile](https://github.com/runpod-workers/worker-comfyui/blob/5.8.5/Dockerfile) has no unconditional PyTorch upgrade.
- This project's Dockerfile reinstalls ComfyUI requirements but does not explicitly replace PyTorch. The [pinned requirements](https://github.com/Comfy-Org/ComfyUI/blob/7cebca52227c63b4180ceed448cbd7ad22903b6d/requirements.txt) specify `torch` without a minimum version or CUDA build.
- The [exact pinned quantization code](https://github.com/Comfy-Org/ComfyUI/blob/7cebca52227c63b4180ceed448cbd7ad22903b6d/comfy/quant_ops.py#L20-L38) disables the comfy-kitchen CUDA backend when `torch.version.cuda` is below 13. It also disables the Triton backend unless explicitly enabled. The current Modal command does not enable that backend.

Inference: if the deployed image retained a cu126 PyTorch build, it is missing this accelerated CUDA path. Installing compiler headers alone does not select the backend. This needs verification inside the actual GPU container; the CUDA version shown by `nvidia-smi` is not the PyTorch build version.

Read-only diagnostic to run inside the MOSS worker:

```python
import torch
import comfy_kitchen as ck

print("torch:", torch.__version__)
print("torch CUDA build:", torch.version.cuda)
print("GPU:", torch.cuda.get_device_name(0))
print("GPU capability:", torch.cuda.get_device_capability(0))
print("kitchen backends:", ck.list_backends())
```

Also retain ComfyUI startup logs identifying enabled backends and any fallback warnings. If cu126 is confirmed, build a separate image with a compatible cu130-or-newer PyTorch stack and verify kernel dispatch before comparing model formats. CUDA runtime compatibility is specific to this ComfyUI backend; it is not a claim that all BF16 MOSS implementations require CUDA 13.

The local Modal CLI could not find a deployed app named `ideogram-builder` in its current environment/profile. Therefore the deployed package versions and logs were not verified during this research.

## 2. Use the 96 GB GPU to benchmark residency and precision

The present files are a useful memory-saving configuration, but memory capacity is generous on this GPU. Benchmark these independently:

1. Existing INT8 DiT and W4A8 encoder with the verified accelerated runtime.
2. BF16 DiT with the same encoder.
3. The faster DiT option with an INT8 encoder, then a BF16 encoder.
4. Default memory management versus `--highvram`, then `--gpu-only` if the complete workload fits comfortably.

These flags are implemented in the [pinned ComfyUI command-line options](https://github.com/Comfy-Org/ComfyUI/blob/7cebca52227c63b4180ceed448cbd7ad22903b6d/comfy/cli_args.py#L149-L161). They are alternatives, not flags to combine. Check actual transfers and VRAM use; current automatic management may already keep the important weights resident.

Prediction to test: eliminating repeated transfers may help warm requests, while BF16 could win if quantization overhead dominates. Neither is guaranteed. An [A100 ConvRot performance report](https://github.com/Comfy-Org/ComfyUI/issues/14824) shows that quantization speed varies by GPU/kernel combination; it is evidence against universal speed claims, not a benchmark for this RTX PRO 6000.

Keep the text encoder and VAE fixed during the DiT comparison. Measure new prompts separately from seed-only reruns, since a cached text encoding can hide encoder cost. Extra host RAM and sufficient CPU resources should be assessed if loading or PNG encoding is slow.

## 3. Add an independent four-step candidate

The [akhaliq adapter](https://huggingface.co/akhaliq/MOSS-Image-SFT-4-steps) now has an Euler-native release. Its [bundled ComfyUI workflow](https://huggingface.co/akhaliq/MOSS-Image-SFT-4-steps/blob/main/comfyui/moss-image-4step-turbo.json) uses a BF16 SFT DiT, a model-only LoRA loader at strength 1, four steps, CFG 1, and `euler` / `simple`; there is no SLG node. Start with that documented combination rather than assuming the current INT8 DiT gives identical adapter behavior.

The author identifies precision sensitivity in the adapter deltas and provides an FP32 alternative. Inspect fine text before accepting a merged or quantized variant. Above roughly one megapixel, the card recommends more steps. A separately trained three-step adapter exists; the two-step experiment has documented quality problems.

Arithmetic: four denoiser steps are half the eight-step Turbo count. That suggests approximately half the sampling work at otherwise equal per-step cost, not half the full request time. Encoder, decoder, LoRA handling, loading and transport remain. Compared with Fast, CFG 1 also removes the unconditional denoiser branch; simple step ratios cannot predict total latency.

Do not substitute the older [darask0 rapid-moss adapter](https://huggingface.co/darask0/MOSS-Image_4-step_adapter_lora) into this graph as if it were the same release. It includes a different data-space loop and auxiliary files. Its reported 0.81-second H100 result measures the DiT only and excludes text encoding and decoding.

## 4. Evaluate Spectrum for Fast and Quality

[ComfyUI-Spectrum-MOSS](https://github.com/Rkkss/ComfyUI-Spectrum-MOSS) forecasts intermediate features so some transformer evaluations can be skipped. Its README claims around 2–2.5× speed improvement for its default setup; this is the extension author's claim, with no matching Modal/RTX PRO 6000 benchmark located.

The extension supports Euler and ER-SDE, and release v0.8.1 updates the ER-SDE bridge. For an initial Fast experiment, retain the current sampler and use the documented conservative ER-SDE limit of one consecutive forecast. The author recommends an SLG range of 0–1 because a partial range makes forecasting history rebuild. Test that guidance-range change separately from enabling Spectrum so its quality effect remains attributable. Quality already uses the full range.

The [v0.8.1 source](https://github.com/Rkkss/ComfyUI-Spectrum-MOSS/blob/v0.8.1/nodes.py) sets eight warmup steps and one actual final step by default. Consequently, on an eight-step Turbo run the default warmup covers the entire run; adding the node should not be expected to accelerate it. Four-step sampling has even less usable history. Reducing warmup is a separate quality-risk experiment, not a proven multiplicative gain.

Evaluate exact lettering, small digits, subject count, hands, and bounding-box adherence. Feature forecasting is approximate, so image similarity alone is not an adequate acceptance criterion. Establish Spectrum and compilation results independently before attempting to stack their patches.

## 5. Compile only after measuring the simpler changes

The project's ComfyUI pin already contains the experimental [TorchCompileModel node](https://github.com/Comfy-Org/ComfyUI/blob/7cebca52227c63b4180ceed448cbd7ad22903b6d/comfy_extras/nodes_torch_compile.py). A separate compiler-node package is not required for an initial test. [OpenMOSS's own runtime](https://github.com/OpenMOSS/MOSS-Image/blob/main/inference_runtime.py) also exposes optional block compilation, which is disabled by default.

Try a fixed resolution, prompt-length range and LoRA configuration first. Record first compilation separately from warm sampling. Recompilation or startup cost can outweigh warm gains on a scale-to-zero service. Because this pin already has a Comfy compiler path, compare its existing behavior against an explicit TorchCompileModel configuration rather than labeling the current baseline fully uncompiled.

[PyTorch documents](https://docs.pytorch.org/tutorials/recipes/torch_compile_caching_tutorial.html) compiler artifact caches and their version/GPU compatibility constraints. Persist compatible caches on a dedicated Modal volume if this experiment wins. Avoid expensive autotuning before knowing how often a container is reused.

## 6. Treat cold starts as a separate latency problem

The MOSS GPU class scales to zero and keeps an idle container for five minutes. The always-warm HTTP proxy does not keep the GPU worker warm. Startup waits for the ComfyUI HTTP server, but does not execute a representative workflow to load and warm its models.

Measure the first request after a fresh GPU worker separately from subsequent requests. A longer idle window or a warm MOSS worker can improve interactive response time, at the cost of idle GPU billing. Moving model warmup into startup changes when the cost occurs; it does not eliminate it. [Modal's cold-start guide](https://modal.com/docs/guide/cold-start) explains these controls.

[Modal GPU snapshots](https://modal.com/docs/guide/memory-snapshots) are an alpha option for expensive initialization and compilation. They need compatibility testing with this subprocess-based server. Modal explicitly says snapshots do not accelerate storage-bound weight loading and can add overhead there. They are a later experiment, not a guaranteed fix for loading a large checkpoint.

## Published same-GPU reference

[TokenWatt's first-hand benchmark](https://www.tokenwatt.io/blog/moss-image-gpu-cost-50-vs-4-steps.html) measured a warm RTX PRO 6000 on RunPod:

| Configuration | Reported seconds per 1024×1024 image |
| --- | --- |
| SFT, 50 steps, CFG 3 | 22.6 |
| akhaliq four-step adapter, CFG 1 | 1.6 |
| Separate three-step adapter, CFG 1 | 1.25 |

It used six prompts and two seeds. Its visual review found a less natural photographic look with distillation. These are external results, not Modal latency targets. The [published run index](https://www.tokenwatt.io/data/moss-image/index.json) identifies a Diffusers harness, BF16 weights on this GPU, pinned model revisions, and a different software stack from this project's ComfyUI setup. Cold starts and frontend polling are outside this comparison.

## Lower-priority routes and misleading shortcuts

- **Updating ComfyUI alone:** v0.43.0 was released today. Comparing the project's pin to that tag gives 11 subsequent commits; the MOSS-specific additions include a small peak-memory reduction and a model-merge node. Useful maintenance, but no demonstrated large inference-time gain on this 96 GB target. See the [release notes](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.43.0) and [comparison](https://github.com/Comfy-Org/ComfyUI/compare/7cebca52227c63b4180ceed448cbd7ad22903b6d...v0.43.0).
- **SageAttention:** a [direct MOSS user report](https://huggingface.co/Comfy-Org/MOSS-Image/discussions/2) describes desaturated, corrupted-looking output on a 3090. That is not a universal incompatibility finding. Keep an established attention backend as the reference and require a matched quality comparison for alternatives.
- **GGUF or smaller quants:** primarily investigate them when memory is limiting. There is no established reason to prioritize them for this GPU over a working accelerated INT8/BF16 path. [Comfy-Org's discussion](https://huggingface.co/Comfy-Org/MOSS-Image/discussions/4) also describes kernel-dependent speed differences.
- **Changing CFG from 3 to 2.5:** still requires the unconditional branch; it does not deliver the CFG-1 branch elimination. Do not set CFG 1 on an undistilled preset and assume quality is preserved. [ComfyUI's sampling implementation](https://github.com/Comfy-Org/ComfyUI/blob/7cebca52227c63b4180ceed448cbd7ad22903b6d/comfy/samplers.py) makes this distinction explicit.
- **SGLang/vLLM migration:** model support exists, but the [SGLang MOSS recipe](https://docs.sglang.io/cookbook/diffusion/OpenMOSS/MOSS-Image) does not validate its MOSS LoRA/quantization/compilation combinations, and its checkpoint validation focuses on Base. The [vLLM recipe](https://recipes.vllm.ai/OpenMOSS-Team/MOSS-Image-Base) provides a serving path, without establishing a speed advantage over this ComfyUI deployment. Migration is not the first experiment.
- **TensorRT, Nunchaku, generic TeaCache:** no sufficiently documented, validated MOSS ComfyUI recipe was found in this search. This is a search limitation, not proof none exists.

## Proposed benchmark order

1. Capture deployed package versions, GPU identity, enabled kernels and stage timings.
2. Fix any verified CUDA fallback; establish Fast, Quality and Turbo baselines.
3. Test residency, then DiT precision, then encoder precision, changing one variable at a time.
4. Compare a separate four-step preset with current Turbo at approximately one megapixel.
5. Compare Spectrum against Fast and Quality, including a separate SLG-window control.
6. Test compilation on the strongest validated workflow, then assess cold-start/cache economics.

For each candidate, use several fixed prompts covering English and Chinese text, numbers, dense layouts, people and natural photos. Start with three seeds and 1024×1024; also test the app's common portrait/landscape dimensions before adoption. Keep resolutions and all quality settings matched within each comparison.

Record queue/worker startup, loading, positive and negative encoding, denoising, VAE decoding, saving/serialization and client delivery separately. Use one warmup followed by at least five measured runs for an initial latency comparison, with varied seeds to prevent reuse of the entire generated result. Include new-prompt runs and cached-prompt runs. Expand the sample before claiming tail-latency improvements.

Report median warm latency, cold latency, peak VRAM and acceptable images per second. For a layout builder, OCR accuracy and box adherence should be gates alongside visual quality. A fast setting that needs extra rerolls may be slower per usable result.

No deployment, application code, model download or GPU generation was performed as part of this research.
