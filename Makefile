IMAGE_NAME ?= butter-roll
IMAGE_TAG  ?= latest

.PHONY: proto build lint docker-build docker-run docker-save dev-frontend dev-backend

# Regenerate Go + TypeScript types from proto/butterroll/v1/*.proto.
# Runs on every build/dev/docker target so generated code is never stale.
# Requires: buf and protoc-gen-go on PATH
# (go install google.golang.org/protobuf/cmd/protoc-gen-go@latest).
# protoc-gen-es comes from front-end/node_modules, so the front-end deps
# (installed via the node_modules target below) are a prerequisite.
proto: front-end/node_modules
	buf generate proto

# Install front-end deps only when package.json changes. Other targets depend
# on this (via proto) so a clean checkout bootstraps itself.
front-end/node_modules: front-end/package.json front-end/package-lock.json
	cd front-end && npm install
	touch front-end/node_modules

# Build frontend and Go binary locally (binary at back-end/butter-roll)
build: proto
	cd front-end && npm run build
	rm -rf back-end/dist
	cp -r front-end/dist back-end/dist
	cd back-end && go build -o butter-roll .

# Lint both halves against the size/complexity guardrails (see
# documentation/REFACTORING.md). Front-end via ESLint; back-end via
# golangci-lint (go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest).
lint: front-end/node_modules
	cd front-end && npm run lint
	cd back-end && golangci-lint run

# Build the Docker image. Codegen runs on the host first; the generated code is
# then copied into the image (the Dockerfile does not run buf itself).
docker-build: proto
	docker buildx build --platform linux/amd64 --load -t $(IMAGE_NAME):$(IMAGE_TAG) .

# Run the Docker image locally (mounts ./data for persistence)
docker-run:
	docker run --rm -p 8080:8080 \
		-v "$(PWD)/data:/data" \
		-e DATA_DIR=/data \
		$(IMAGE_NAME):$(IMAGE_TAG)

# Export the image as a gzip tarball for import on Synology Container Manager
docker-save:
	docker save $(IMAGE_NAME):$(IMAGE_TAG) | gzip > $(IMAGE_NAME).tar.gz

# Run the Vite dev server on port 5173. --strictPort makes it fail if 5173 is
# already in use instead of silently moving to 5174, which would change the
# browser origin and break the backend's WebSocket allowed-origin check.
dev-frontend: proto
	cd front-end && npm run dev -- --port 5173 --strictPort

# Run the Go server in dev mode (opens CORS to the Vite dev server on 5173)
dev-backend: proto
	cd back-end && ALLOWED_ORIGIN=http://localhost:5173 go run -tags dev .
