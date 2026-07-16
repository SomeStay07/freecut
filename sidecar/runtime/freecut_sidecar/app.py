from __future__ import annotations

import asyncio
import os
import signal
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .config import Settings
from .events import EventBroker, WebSocketTicketStore
from .jobs import JobManager, TextToImageRequest
from .models import MODELS


class PairRequest(BaseModel):
    code: str = Field(min_length=6, max_length=32)


class CreateJobRequest(BaseModel):
    operation: Literal["text-to-image"]
    model: str
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str | None = Field(default=None, max_length=4000)
    width: int = Field(default=512, ge=256, le=2048, multiple_of=8)
    height: int = Field(default=512, ge=256, le=2048, multiple_of=8)
    steps: int | None = Field(default=None, ge=1, le=100)
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)


def create_app(
    settings: Settings | None = None,
    jobs: JobManager | None = None,
    shutdown_callback: Callable[[], None] | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    event_broker = EventBroker()
    ticket_store = WebSocketTicketStore()
    job_manager = jobs or JobManager(
        resolved_settings.data_dir / "outputs",
        on_event=lambda event_type, payload, job_id: event_broker.publish(
            event_type, payload, job_id=job_id
        ),
    )
    resolved_shutdown = shutdown_callback or terminate_process

    async def publish_telemetry() -> None:
        while True:
            if hasattr(job_manager, "telemetry"):
                event_broker.publish("runtime.vram_updated", job_manager.telemetry())
            await asyncio.sleep(2)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        telemetry_task = asyncio.create_task(publish_telemetry())
        try:
            yield
        finally:
            telemetry_task.cancel()
            await asyncio.gather(telemetry_task, return_exceptions=True)

    app = FastAPI(
        title="FreeCut Local",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.event_broker = event_broker
    app.state.ticket_store = ticket_store
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
        if authorization != f"Bearer {resolved_settings.auth_token}":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized"
            )

    @app.get("/v1/health")
    def health() -> dict[str, object]:
        return {
            "service": "freecut-local",
            "version": "0.1.0",
            "events_version": 1,
            "ready": True,
        }

    @app.post("/v1/pair")
    def pair(request: PairRequest) -> dict[str, str]:
        if request.code.upper() != resolved_settings.pairing_code.upper():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Invalid pairing code"
            )
        return {"token": resolved_settings.auth_token}

    @app.get("/v1/capabilities", dependencies=[Depends(authorize)])
    def capabilities() -> dict[str, object]:
        return job_manager.capabilities()

    @app.get("/v1/models", dependencies=[Depends(authorize)])
    def models() -> dict[str, object]:
        return {
            "models": [
                {
                    "id": model.id,
                    "label": model.label,
                    "operation": model.operation,
                    "estimated_bytes": model.estimated_bytes,
                    "default_steps": model.default_steps,
                }
                for model in MODELS
            ]
        }

    @app.post("/v1/events/ticket", dependencies=[Depends(authorize)])
    def create_events_ticket(
        origin: Annotated[str | None, Header()] = None,
    ) -> dict[str, object]:
        if origin not in resolved_settings.allowed_origins:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Origin is not allowed",
            )
        return {
            "ticket": ticket_store.issue(origin),
            "expires_in_seconds": ticket_store.ttl_seconds,
        }

    @app.websocket("/v1/events")
    async def events_socket(
        websocket: WebSocket,
        ticket: Annotated[str, Query(min_length=16)],
    ) -> None:
        origin = websocket.headers.get("origin", "")
        if origin not in resolved_settings.allowed_origins or not ticket_store.consume(
            ticket, origin
        ):
            await websocket.close(code=4403)
            return

        await websocket.accept()
        subscription = event_broker.subscribe()
        try:
            connected_payload = (
                job_manager.capabilities()
                if hasattr(job_manager, "capabilities")
                else {"backend": "native"}
            )
            event_broker.publish("runtime.connected", connected_payload)
            while True:
                await websocket.send_json(await subscription.queue.get())
        except WebSocketDisconnect:
            pass
        finally:
            event_broker.unsubscribe(subscription.id)

    @app.post(
        "/v1/jobs",
        status_code=status.HTTP_202_ACCEPTED,
        dependencies=[Depends(authorize)],
    )
    def create_job(request: CreateJobRequest) -> dict[str, object]:
        try:
            job = job_manager.create(
                TextToImageRequest(
                    model=request.model,
                    prompt=request.prompt,
                    negative_prompt=request.negative_prompt,
                    width=request.width,
                    height=request.height,
                    steps=request.steps,
                    seed=request.seed,
                )
            )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error
        return job.public_dict()

    @app.get("/v1/jobs/{job_id}", dependencies=[Depends(authorize)])
    def get_job(job_id: str) -> dict[str, object]:
        job = job_manager.get(job_id)
        if job is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Job not found"
            )
        return job.public_dict()

    @app.delete("/v1/jobs/{job_id}", dependencies=[Depends(authorize)])
    def cancel_job(job_id: str) -> dict[str, object]:
        job = job_manager.cancel(job_id)
        if job is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Job not found"
            )
        return job.public_dict()

    @app.get("/v1/jobs/{job_id}/result", dependencies=[Depends(authorize)])
    def get_result(job_id: str) -> FileResponse:
        job = job_manager.get(job_id)
        if job is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Job not found"
            )
        if job.state != "completed" or not job.output_path:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Result is not ready"
            )
        return FileResponse(
            job.output_path, media_type="image/png", filename=f"freecut-{job_id}.png"
        )

    @app.post("/v1/runtime/unload", dependencies=[Depends(authorize)])
    def unload_runtime() -> dict[str, bool]:
        job_manager.unload()
        return {"unloaded": True}

    @app.post("/v1/runtime/shutdown", dependencies=[Depends(authorize)])
    def shutdown(background_tasks: BackgroundTasks) -> dict[str, bool]:
        job_manager.unload()
        background_tasks.add_task(resolved_shutdown)
        return {"shutting_down": True}

    return app


def terminate_process() -> None:
    os.kill(os.getpid(), signal.SIGTERM)
