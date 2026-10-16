FROM mcr.microsoft.com/devcontainers/javascript-node:22

# Install additional tools if needed
RUN apt-get update && apt-get install -y \
    postgresql-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
