FROM python:3.11-slim

WORKDIR /app

# CPU-only PyTorch first — the CUDA wheel is 2GB, CPU is ~200MB.
# Must happen before open-clip-torch so it doesn't pull the CUDA wheel.
RUN pip install --no-cache-dir \
    torch \
    --index-url https://download.pytorch.org/whl/cpu

# Application dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download ViT-B/32 openai weights (~350MB) at build time.
# This bakes them into the image layer so startup is instant.
RUN python -c "\
import open_clip; \
print('Downloading ViT-B-32 (openai) weights...'); \
open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai'); \
print('Done.')"

COPY clip_service.py .

EXPOSE 8080

# Single worker — model is large (~500MB RSS), multiple workers would
# replicate it. Throughput is fine for our embed volume.
CMD ["uvicorn", "clip_service:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--log-level", "info"]
