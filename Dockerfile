FROM node:22-alpine AS ui-build
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
# Build outputs to /ui/dist (we'll copy it to serve/static in next stage)
RUN npx vite build --outDir /frontend

FROM golang:1.26-alpine AS go-build
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
COPY serve/go.mod serve/go.sum ./
RUN go mod download
COPY serve/ ./
COPY --from=ui-build /frontend ./static/
RUN CGO_ENABLED=0 go build -o /drifting-serve .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=go-build /drifting-serve /usr/local/bin/
EXPOSE 8080
ENTRYPOINT ["drifting-serve"]
