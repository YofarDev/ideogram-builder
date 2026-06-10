FROM runpod/worker-comfyui:5.8.5-base

# Ideogram-4 needs DualModelGuider which was added in a recent ComfyUI commit
# The base image has comfy-cli v1.6.0 which is too old for --commit flag
# Manually update ComfyUI to the latest master branch
RUN rm -rf /comfyui && \
    git clone https://github.com/comfyanonymous/ComfyUI.git /comfyui && \
    cd /comfyui && \
    pip install -r requirements.txt

# Install custom nodes needed for the Ideogram-4 workflow
RUN comfy-node-install comfyui-kjnodes rgthree-comfy

# Download the 4 Ideogram-4 model files
RUN comfy model download \
  --url https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_fp8_scaled.safetensors \
  --relative-path models/diffusion_models \
  --filename ideogram4_fp8_scaled.safetensors

RUN comfy model download \
  --url https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_unconditional_fp8_scaled.safetensors \
  --relative-path models/diffusion_models \
  --filename ideogram4_unconditional_fp8_scaled.safetensors

RUN comfy model download \
  --url https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/text_encoders/qwen3vl_8b_fp8_scaled.safetensors \
  --relative-path models/text_encoders \
  --filename qwen3vl_8b_fp8_scaled.safetensors

RUN comfy model download \
  --url https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/vae/flux2-vae.safetensors \
  --relative-path models/vae \
  --filename flux2-vae.safetensors

# Copy custom handler and workflow template
COPY src/handler.py /handler.py
COPY src/workflow_template.json /workflow_template.json

CMD ["/start.sh"]
