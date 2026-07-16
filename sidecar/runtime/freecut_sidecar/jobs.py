from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from time import time
from typing import Callable, Literal
from uuid import uuid4

from .models import MODELS_BY_ID, ModelDefinition

JobState = Literal["queued", "loading", "running", "completed", "failed", "cancelled"]


@dataclass
class Job:
    id: str
    operation: str
    model: str
    state: JobState
    progress: float
    message: str
    created_at: float
    updated_at: float
    output_path: str | None = None
    error: str | None = None
    cancel_requested: bool = False

    def public_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload.pop("output_path")
        payload.pop("cancel_requested")
        payload["result_url"] = (
            f"/v1/jobs/{self.id}/result" if self.state == "completed" else None
        )
        return payload


@dataclass(frozen=True)
class TextToImageRequest:
    model: str
    prompt: str
    negative_prompt: str | None
    width: int
    height: int
    steps: int | None
    seed: int | None


class JobCancelled(RuntimeError):
    pass


class DiffusersEngine:
    def __init__(self) -> None:
        self._pipelines: dict[str, object] = {}

    def device_info(self) -> tuple[str, str]:
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda", torch.cuda.get_device_name(0)
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return "mps", "Apple Metal"
        except ImportError:
            pass
        return "cpu", "CPU"

    def unload(self) -> None:
        self._pipelines.clear()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    def telemetry(self) -> dict[str, object]:
        backend, device_name = self.device_info()
        telemetry: dict[str, object] = {
            "accelerator": backend,
            "deviceName": device_name,
            "vramUsedBytes": None,
            "vramReservedBytes": None,
            "vramTotalBytes": None,
        }
        try:
            import torch

            if backend == "cuda":
                free_bytes, total_bytes = torch.cuda.mem_get_info()
                telemetry.update(
                    vramUsedBytes=total_bytes - free_bytes,
                    vramReservedBytes=torch.cuda.memory_reserved(),
                    vramTotalBytes=total_bytes,
                )
            elif backend == "mps" and hasattr(torch.mps, "current_allocated_memory"):
                telemetry["vramUsedBytes"] = torch.mps.current_allocated_memory()
        except (ImportError, RuntimeError):
            pass
        return telemetry

    def generate(
        self,
        definition: ModelDefinition,
        request: TextToImageRequest,
        output_path: Path,
        on_progress: Callable[[float, str], None],
        is_cancelled: Callable[[], bool],
    ) -> None:
        import torch
        from diffusers import DiffusionPipeline

        device, _ = self.device_info()
        pipeline = self._pipelines.get(definition.id)
        if pipeline is None:
            on_progress(0.08, "Loading model")
            dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32
            pipeline = DiffusionPipeline.from_pretrained(
                definition.source,
                torch_dtype=dtype,
                use_safetensors=True,
                trust_remote_code=False,
            )
            pipeline = pipeline.to(device)
            self._pipelines[definition.id] = pipeline

        if is_cancelled():
            raise JobCancelled()

        steps = request.steps or definition.default_steps

        def step_callback(_pipeline, step: int, _timestep, callback_kwargs):
            if is_cancelled():
                raise JobCancelled()
            on_progress(0.15 + (0.8 * (step + 1) / max(steps, 1)), "Generating")
            return callback_kwargs

        generator = None
        if request.seed is not None:
            generator_device = "cpu" if device == "mps" else device
            generator = torch.Generator(device=generator_device).manual_seed(
                request.seed
            )

        result = pipeline(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            width=request.width,
            height=request.height,
            num_inference_steps=steps,
            guidance_scale=0.0 if definition.id == "sd-turbo" else 7.5,
            generator=generator,
            callback_on_step_end=step_callback,
        )
        image = result.images[0]
        image.save(output_path, format="PNG")


class JobManager:
    def __init__(
        self,
        output_dir: Path,
        engine: DiffusersEngine | None = None,
        on_event: Callable[[str, dict[str, object], str | None], None] | None = None,
    ) -> None:
        self._output_dir = output_dir
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._engine = engine or DiffusersEngine()
        self._on_event = on_event
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="freecut-inference"
        )

    def capabilities(self) -> dict[str, object]:
        backend, device_name = self._engine.device_info()
        return {
            "backend": "native",
            "accelerator": backend,
            "device_name": device_name,
            "operations": ["text-to-image"],
        }

    def telemetry(self) -> dict[str, object]:
        return self._engine.telemetry()

    def create(self, request: TextToImageRequest) -> Job:
        definition = MODELS_BY_ID.get(request.model)
        if definition is None or definition.operation != "text-to-image":
            raise ValueError("Unsupported model")

        now = time()
        job = Job(
            id=str(uuid4()),
            operation="text-to-image",
            model=request.model,
            state="queued",
            progress=0.0,
            message="Queued",
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._jobs[job.id] = job
        self._emit("job.queued", job)
        self._executor.submit(self._run, job.id, definition, request)
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        event: tuple[str, Job] | None = None
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.cancel_requested = True
            if job.state == "queued":
                job.state = "cancelled"
                job.message = "Cancelled"
                job.updated_at = time()
                event = ("job.cancelled", job)
        if event:
            self._emit(*event)
        return job

    def unload(self) -> None:
        self._engine.unload()
        if self._on_event:
            self._on_event("model.unloaded", {"all": True}, None)

    def _update(self, job_id: str, **updates: object) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for key, value in updates.items():
                setattr(job, key, value)
            job.updated_at = time()
            state = job.state
        event_type = {
            "loading": "job.started",
            "running": "job.progress",
            "completed": "job.completed",
            "failed": "job.failed",
            "cancelled": "job.cancelled",
        }.get(state)
        if event_type:
            self._emit(event_type, job)

    def _emit(self, event_type: str, job: Job) -> None:
        if self._on_event:
            self._on_event(event_type, job.public_dict(), job.id)

    def _run(
        self,
        job_id: str,
        definition: ModelDefinition,
        request: TextToImageRequest,
    ) -> None:
        job = self.get(job_id)
        if job is None or job.state == "cancelled":
            return

        output_path = self._output_dir / f"{job_id}.png"
        try:
            self._update(
                job_id, state="loading", progress=0.02, message="Preparing runtime"
            )
            self._engine.generate(
                definition,
                request,
                output_path,
                lambda progress, message: self._update(
                    job_id,
                    state="running",
                    progress=progress,
                    message=message,
                ),
                lambda: bool(self.get(job_id) and self.get(job_id).cancel_requested),
            )
            self._update(
                job_id,
                state="completed",
                progress=1.0,
                message="Completed",
                output_path=str(output_path),
            )
        except JobCancelled:
            output_path.unlink(missing_ok=True)
            self._update(job_id, state="cancelled", message="Cancelled")
        except Exception as error:  # Inference exceptions must become job failures.
            output_path.unlink(missing_ok=True)
            self._update(
                job_id, state="failed", message="Generation failed", error=str(error)
            )
