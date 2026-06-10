FROM runpod/worker-comfyui:5.8.5-base

# Ideogram-4 needs DualModelGuider which was added in a recent ComfyUI commit
# The base image has comfy-cli v1.6.0 which is too old for --commit flag
# Manually update ComfyUI to the latest master branch
RUN rm -rf /comfyui && \
    git clone https://github.com/comfyanonymous/ComfyUI.git /comfyui && \
    cd /comfyui && \
    pip install -r requirements.txt

# Install custom nodes needed for the Ideogram-4 workflow
# Clone directly into custom_nodes since comfy-node-install may not work without comfy-cli workspace
RUN git clone https://github.com/kijai/ComfyUI-KJNodes.git /comfyui/custom_nodes/ComfyUI-KJNodes && \
    cd /comfyui/custom_nodes/ComfyUI-KJNodes && \
    pip install -r requirements.txt
RUN git clone https://github.com/rgthree/rgthree-comfy.git /comfyui/custom_nodes/rgthree-comfy && \
    cd /comfyui/custom_nodes/rgthree-comfy && \
    pip install -r requirements.txt

# Download the 4 Ideogram-4 model files
RUN mkdir -p /comfyui/models/diffusion_models /comfyui/models/text_encoders /comfyui/models/vae
RUN wget -q -O /comfyui/models/diffusion_models/ideogram4_fp8_scaled.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_fp8_scaled.safetensors
RUN wget -q -O /comfyui/models/diffusion_models/ideogram4_unconditional_fp8_scaled.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_unconditional_fp8_scaled.safetensors
RUN wget -q -O /comfyui/models/text_encoders/qwen3vl_8b_fp8_scaled.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/text_encoders/qwen3vl_8b_fp8_scaled.safetensors
RUN wget -q -O /comfyui/models/vae/flux2-vae.safetensors https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/vae/flux2-vae.safetensors

# Dockerfile lives in runpod/ but build context is repo root
# Copy custom handler and workflow template
COPY runpod/handler.py /handler.py
COPY runpod/workflow_template.json /workflow_template.json

CMD ["/start.sh"]
