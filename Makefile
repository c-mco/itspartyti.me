.PHONY: run build test logs-setup deploy deploy-preview

VERSION := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

PROD_BINARY    := /Users/cam/itspartyti.me/server
PREVIEW_BINARY := /Users/cam/itspartyti.me-preview/server

run:
	go run ./cmd/server

build:
	go build -ldflags "-X main.version=$(VERSION)" -o server ./cmd/server

test:
	go test ./...

logs-setup:
	sudo cp deploy/newsyslog.conf /etc/newsyslog.d/itspartyti.me.conf
	sudo newsyslog -v

# Run from main branch to deploy production.
deploy:
	@[ "$$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] || \
		{ echo "error: deploy must run from the main branch"; exit 1; }
	go build -ldflags "-X main.version=$(VERSION)" -o $(PROD_BINARY).new ./cmd/server
	cp $(PROD_BINARY) $(PROD_BINARY).prev 2>/dev/null || true
	mv $(PROD_BINARY).new $(PROD_BINARY)
	launchctl kickstart -k gui/$$(id -u)/me.itspartyti.server

# Run from UAT branch to deploy preview.
deploy-preview:
	@[ "$$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "UAT" ] || \
		{ echo "error: deploy-preview must run from the UAT branch"; exit 1; }
	go build -ldflags "-X main.version=$(VERSION)" -o server.preview ./cmd/server
	cp $(PREVIEW_BINARY) $(PREVIEW_BINARY).prev 2>/dev/null || true
	mv server.preview $(PREVIEW_BINARY)
	launchctl kickstart -k gui/$$(id -u)/me.itspartyti.preview
