# butter-roll

A virtual tabletop app with a Go backend and React frontend, served as a single Docker container.

## Building the Docker image

```bash
make docker-build
```

This runs a multi-stage build:

1. Compiles the React frontend with `npm run build`
2. Embeds the output into the Go binary
3. Produces a minimal Alpine-based image (~20MB)

## Running locally

```bash
make docker-run
```

Opens the app at `http://localhost:8080`. Game state and uploaded assets are stored in `./data/` on the host.

## Deploying to Synology

**1. Build and export the image:**

```bash
make docker-build
make docker-save   # produces butter-roll.tar.gz
```

**2. Import on the Synology NAS:**

Open **Container Manager** → **Registry** → **Import** and select `butter-roll.tar.gz`.

**3. Start the container:**

Use the included `docker-compose.yml` via **Container Manager** → **Project** → **Create**, or run manually and map port `8080` with a volume mounted to `/data`.

## Development

Run the backend and frontend separately with hot reload:

```bash
# Terminal 1 — Vite dev server on :5173
make dev-frontend

# Terminal 2 — Go server on :8080 (CORS open to :5173)
make dev-backend
```

## Makefile reference

| Target              | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `make build`        | Build frontend + Go binary locally (no Docker)           |
| `make docker-build` | Build the Docker image                                   |
| `make docker-run`   | Run the image locally on port 8080                       |
| `make docker-save`  | Export image to `butter-roll.tar.gz` for Synology import |
| `make dev-frontend` | Start Vite dev server                                    |
| `make dev-backend`  | Start Go server with CORS open to the Vite dev server    |
