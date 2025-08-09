$env:REDIS_URL="redis://localhost:6380/0"
$env:POSTGRES_URL="postgres://postgres:postgres@localhost:5432/mkwwmcp"
$env:JWT_SECRET="dev_secret_key_here"
$env:HMAC_GITHUB_SECRET="dev_github_webhook_secret"

# Start the server
npm run dev
