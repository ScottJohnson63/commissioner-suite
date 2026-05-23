from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import nfl
import ssl
import certifi

ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())

app = FastAPI(title="Fantasy AI API", version="1.0.0")

# Only allow the Next.js server — not the browser — to call this
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(nfl.router, prefix="/nfl")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}