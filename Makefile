.PHONY: dev dev-local build ui-build go-build docker clean

dev: ## Start dev environment with Docker
	docker compose -f docker-compose.dev.yml up --build

dev-local: ## Start without Docker (requires Go + Node locally)
	@echo "Start in two terminals:"
	@echo "  Terminal 1: cd serve && go run . --dir ../fixtures"
	@echo "  Terminal 2: cd ui && npm run dev"

build: ui-build go-build ## Build production binary

ui-build: ## Build frontend
	cd ui && npm ci && npm run build

go-build: ## Build Go server (with embedded frontend)
	cd serve && go build -o ../bin/drifting-serve .

docker: ## Build production Docker image
	docker build -t drifting-serve .

clean: ## Remove build artifacts
	rm -rf serve/static ui/node_modules bin/
