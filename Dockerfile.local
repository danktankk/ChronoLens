FROM python:3.11-slim

RUN apt-get update && apt-get install -y chrony gpsd-clients wget unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download Tailwind for offline viewing
RUN mkdir -p /app/static && wget -q https://cdn.tailwindcss.com/ -O /app/static/tailwindcss.js

# Self-host CesiumJS (eliminates ~30MB CDN load on every page visit)
RUN mkdir -p /tmp/cesium && \
    wget -q https://github.com/CesiumGS/cesium/releases/download/1.124/Cesium-1.124.zip -O /tmp/cesium.zip && \
    unzip -q /tmp/cesium.zip -d /tmp/cesium && \
    mkdir -p /app/static/cesium && \
    cp -r /tmp/cesium/Build/Cesium/* /app/static/cesium/ && \
    rm -rf /tmp/cesium /tmp/cesium.zip

# Self-host satellite.js
RUN wget -q https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js -O /app/static/satellite.min.js

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 55234

CMD ["python", "app.py"]
