IMAGE_NAME ?= butter-roll
IMAGE_TAG  ?= latest

.PHONY: build docker-build docker-run docker-save dev-frontend dev-backend

# Build frontend and Go binary locally (binary at back-end/butter-roll)
build:
	cd front-end && npm install && npm run build
	rm -rf back-end/dist
	cp -r front-end/dist back-end/dist
	cd back-end && go build -o butter-roll .

# Build the Docker image
docker-build:
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

# Run the Vite dev server (frontend only, port 5173)
dev-frontend:
	cd front-end && npm run dev

# Run the Go server in dev mode (opens CORS to the Vite dev server)
dev-backend:
	cd back-end && ALLOWED_ORIGIN=http://localhost:5173 go run .
