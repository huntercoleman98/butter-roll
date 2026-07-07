# Stage 1: build the React frontend
FROM node:22-alpine AS frontend
WORKDIR /app
COPY front-end/package*.json ./
RUN npm install
COPY front-end/ ./
RUN npm run build

# Stage 2: build the Go binary (with embedded frontend)
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY back-end/go.mod back-end/go.sum ./
RUN go mod download
COPY back-end/ ./
COPY --from=frontend /app/dist ./dist
RUN go build -o butter-roll .

# Stage 3: minimal runtime image
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/butter-roll .
VOLUME ["/data"]
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["./butter-roll"]
