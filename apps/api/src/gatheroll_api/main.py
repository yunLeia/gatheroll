from collections.abc import Awaitable, Callable

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from starlette.requests import Request
from starlette.responses import Response

from gatheroll_api.config import get_settings
from gatheroll_api.events import router
from gatheroll_api.participants import router as participants_router
from gatheroll_api.photos import router as photos_router


class HealthResponse(BaseModel):
    status: str
    service: str
    environment: str


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Gatheroll API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(participants_router)
    app.include_router(photos_router)

    @app.middleware("http")
    async def protect_responses(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(HTTPException)
    async def domain_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={
                "code": "service_unavailable",
                "message": "Please try again later.",
            },
        )

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="gatheroll-api",
            environment=settings.environment,
        )

    return app


app = create_app()
