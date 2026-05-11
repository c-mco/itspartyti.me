.PHONY: run build test test-js test-all logs-setup

VERSION := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

run:
	go run ./cmd/server

build:
	go build -ldflags "-X main.version=$(VERSION)" -o server ./cmd/server

test:
	go test ./...

test-js:
	node cmd/server/frontend/app.test.mjs

test-all: test test-js

logs-setup:
	sudo cp deploy/newsyslog.conf /etc/newsyslog.d/itspartyti.me.conf
	sudo newsyslog -v
