FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y wget unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Self-host CesiumJS (eliminates ~30MB CDN load on every page visit)
RUN mkdir -p /tmp/cesium && \
    wget -q https://github.com/CesiumGS/cesium/releases/download/1.124/Cesium-1.124.zip -O /tmp/cesium.zip && \
    unzip -q /tmp/cesium.zip -d /tmp/cesium && \
    mkdir -p /app/static/cesium && \
    cp -r /tmp/cesium/Build/Cesium/* /app/static/cesium/ && \
    rm -rf /tmp/cesium /tmp/cesium.zip

# Self-host satellite.js
RUN wget -q https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js -O /app/static/satellite.min.js

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=builder /app/static/cesium /app/static/cesium
COPY --from=builder /app/static/satellite.min.js /app/static/satellite.min.js

EXPOSE 55234

CMD ["gunicorn", "--bind", "0.0.0.0:55234", "--workers", "2", "--timeout", "30", "app:app"]
