FROM alpine:3.19

RUN apk add --no-cache wget unzip ca-certificates

WORKDIR /app

# Download PocketBase
RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v0.22.4/pocketbase_0.22.4_linux_amd64.zip \
    && unzip pocketbase_0.22.4_linux_amd64.zip \
    && rm pocketbase_0.22.4_linux_amd64.zip \
    && chmod +x pocketbase

COPY pb_migrations ./pb_migrations
COPY pb_hooks ./pb_hooks

EXPOSE 8090

CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090"]
