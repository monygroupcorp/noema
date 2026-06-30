---
license: {{LICENSE}}
base_model: {{BASE_MODEL}}
pipeline_tag: text-to-image
tags:
  - text-to-image
  - lora
  - diffusers
  - template:diffusion-lora
  - flux
  - flowmatch
  - noema
widget:
{{WIDGET_YAML}}
instance_prompt: "{{TRIGGER_WORD}}"
training_steps: {{TRAINING_STEPS}}
network_type: lora
library_name: ai-toolkit
---

<p align="center"><a href="https://noema.art"><img src="https://huggingface.co/noema-art/noema-brand/resolve/main/noema-banner.png" alt="NOEMA — run this model privately at noema.art" width="100%"></a></p>

# {{MODEL_NAME}}

> **NOEMA** — privacy-by-construction generative studio.
> Run this model privately at **[noema.art](https://noema.art)** · no email · pay anonymously.

{{GENERATED_DESCRIPTION}}

**Trigger word:** `{{TRIGGER_WORD}}`

## Sample Outputs

{{SAMPLE_IMAGES_GRID}}

## Usage

### ComfyUI

1. Download the `.safetensors` file from the Files tab
2. Place in `ComfyUI/models/loras/`
3. Use the **Load LoRA** node with strength `{{LORA_STRENGTH}}`
4. Include `{{TRIGGER_WORD}}` in your prompt

### Diffusers

```python
import torch
from diffusers import FluxPipeline

pipe = FluxPipeline.from_pretrained(
    "{{BASE_MODEL}}",
    torch_dtype=torch.bfloat16
)
pipe.load_lora_weights("{{HF_REPO_ID}}")
pipe.to("cuda")

image = pipe(
    prompt="{{TRIGGER_WORD}} {{EXAMPLE_PROMPT_SHORT}}",
    guidance_scale={{GUIDANCE_SCALE}},
    num_inference_steps={{INFERENCE_STEPS}},
    generator=torch.Generator("cuda").manual_seed(42)
).images[0]

image.save("output.png")
```

## Recommended Settings

| Parameter | Value |
|-----------|-------|
| LoRA Strength | {{LORA_STRENGTH}} |
| Guidance Scale | {{GUIDANCE_SCALE}} |
| Inference Steps | {{INFERENCE_STEPS}} |
| Resolution | 1024x1024 |

## Example Prompts

{{EXAMPLE_PROMPTS}}

## Training Details

- **Base model:** {{BASE_MODEL}}
- **Training steps:** {{TRAINING_STEPS}}
- **Trigger word:** `{{TRIGGER_WORD}}`
- **Network:** LoRA rank {{LORA_RANK}}, alpha {{LORA_ALPHA}}
- **Optimizer:** {{OPTIMIZER}}, lr {{LEARNING_RATE}}
- **Precision:** {{TRAIN_DTYPE}}
- **Resolution:** {{RESOLUTION}} (multi-res bucketed)

## About

**NOEMA** is a privacy-by-construction generative studio. Run this model — and the rest of the catalogue — privately at **[noema.art](https://noema.art)**: no email to start, pay anonymously, go fully private anytime.

---

<sub>NOEMA · a complete studio, completely private · <a href="https://noema.art">noema.art</a></sub>
