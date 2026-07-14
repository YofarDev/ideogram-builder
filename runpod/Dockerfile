FROM runpod/worker-comfyui:5.8.5-base

# Ideogram-4 needs DualModelGuider which was added in a recent ComfyUI commit
# The base image has comfy-cli v1.6.0 which is too old for --commit flag
# Manually update ComfyUI to the latest master branch
RUN rm -rf /comfyui && \
    git clone https://github.com/comfyanonymous/ComfyUI.git /comfyui && \
    cd /comfyui && \
    pip install -r requirements.txt

# ponytail: woct0rdho fork confirmed supports Ideogram-4 head_dim 256.
# Fall back to `pip install sageattention` if this fork stalls upstream.
RUN pip install git+https://github.com/woct0rdho/SageAttention

# Install custom nodes needed for the Ideogram-4 workflow
# Clone directly into custom_nodes since comfy-node-install may not work without comfy-cli workspace
RUN git clone https://github.com/kijai/ComfyUI-KJNodes.git /comfyui/custom_nodes/ComfyUI-KJNodes && \
    cd /comfyui/custom_nodes/ComfyUI-KJNodes && \
    pip install -r requirements.txt
RUN git clone https://github.com/rgthree/rgthree-comfy.git /comfyui/custom_nodes/rgthree-comfy && \
    cd /comfyui/custom_nodes/rgthree-comfy && \
    pip install -r requirements.txt
# ponytail: BobJohnson24 INT8 node. Required for the *_int8_convrot model format.
# T4 (SM75) needs triton pinned to 3.2.0 if you see kernel build errors.
RUN git clone https://github.com/BobJohnson24/ComfyUI-INT8-Fast.git /comfyui/custom_nodes/ComfyUI-INT8-Fast

# Download the 4 Ideogram-4 model files
RUN mkdir -p /comfyui/models/diffusion_models /comfyui/models/text_encoders /comfyui/models/vae
RUN wget -q -O /comfyui/models/diffusion_models/ideogram4_int8_convrot.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_int8_convrot.safetensors
RUN wget -q -O /comfyui/models/diffusion_models/ideogram4_unconditional_int8_convrot.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_unconditional_int8_convrot.safetensors
RUN wget -q -O /comfyui/models/text_encoders/qwen3vl_8b_fp8_scaled.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/text_encoders/qwen3vl_8b_fp8_scaled.safetensors
RUN wget -q -O /comfyui/models/vae/flux2-vae.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/vae/flux2-vae.safetensors

# Dockerfile lives in runpod/ but build context is repo root
# Copy custom handler and the lora-capable workflow template (live base).
# The original workflow_template.json is kept in the repo as a dormant fallback.
RUN mkdir -p /comfyui/models/loras/ideogram4/control
RUN wget -q -O /comfyui/models/loras/ideogram4/control/ideogram_4_turbotime_v1.safetensors \
    https://huggingface.co/ostris/ideogram_4_turbotime_lora/resolve/main/ideogram_4_turbotime_v1.safetensors
COPY runpod/handler.py /handler.py
COPY runpod/workflow_template_lora_turbo.json /workflow_template_turbo.json
COPY runpod/workflow_template_lora.json /workflow_template_lora.json

CMD ["/start.sh"]
