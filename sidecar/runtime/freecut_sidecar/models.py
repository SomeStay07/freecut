from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelDefinition:
    id: str
    label: str
    source: str
    operation: str
    estimated_bytes: int
    default_steps: int


MODELS: tuple[ModelDefinition, ...] = (
    ModelDefinition(
        id="sd-turbo",
        label="Stable Diffusion Turbo",
        source="stabilityai/sd-turbo",
        operation="text-to-image",
        estimated_bytes=5_500_000_000,
        default_steps=2,
    ),
)

MODELS_BY_ID = {model.id: model for model in MODELS}
