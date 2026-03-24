FROM node:20-bookworm-slim

# System deps: Python, pip, ffmpeg + libs needed by OpenCV/DeepFace
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 python3-pip python3-venv \
       ffmpeg \
       libgl1 libglib2.0-0 \
  && ln -sf /usr/bin/python3 /usr/local/bin/python \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch first — prevents pip from pulling 2GB+ CUDA wheels
# when openai-whisper/deepface later request torch as a dependency.
RUN pip3 install --no-cache-dir --break-system-packages \
    torch --index-url https://download.pytorch.org/whl/cpu

# Install CPU-only TensorFlow before deepface to avoid the 572 MB GPU wheel
RUN pip3 install --no-cache-dir --break-system-packages \
    --default-timeout=300 tensorflow-cpu

# Install remaining Python deps (torch + tf already satisfied)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages \
    --default-timeout=300 -r requirements.txt

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["npm", "start"]

