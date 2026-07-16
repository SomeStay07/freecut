from __future__ import annotations

import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from freecut_sidecar.app import create_app
from freecut_sidecar.config import Settings


class FakeJobs:
    def capabilities(self) -> dict[str, object]:
        return {
            "backend": "native",
            "accelerator": "cpu",
            "device_name": "Test CPU",
            "operations": ["text-to-image"],
        }

    def unload(self) -> None:
        pass


def make_client(tmp_path: Path, shutdown_callback=None) -> TestClient:
    settings = Settings(
        auth_token="secret-token",
        pairing_code="ABC123",
        allowed_origins=("https://freecut.net",),
        data_dir=tmp_path,
    )
    return TestClient(
        create_app(
            settings=settings,
            jobs=FakeJobs(),
            shutdown_callback=shutdown_callback,
        )
    )


def test_pairing_exchanges_valid_code_for_token(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    invalid = client.post("/v1/pair", json={"code": "WRONG1"})
    valid = client.post("/v1/pair", json={"code": "abc123"})

    assert invalid.status_code == 403
    assert valid.status_code == 200
    assert valid.json() == {"token": "secret-token"}


def test_protected_routes_require_bearer_token(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    unauthorized = client.get("/v1/capabilities")
    authorized = client.get(
        "/v1/capabilities",
        headers={"Authorization": "Bearer secret-token"},
    )

    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json()["backend"] == "native"


def test_cors_allows_freecut_but_not_arbitrary_origins(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    headers = {
        "Origin": "https://freecut.net",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    }

    allowed = client.options("/v1/capabilities", headers=headers)
    blocked = client.options(
        "/v1/capabilities",
        headers={**headers, "Origin": "https://attacker.example"},
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://freecut.net"
    assert blocked.status_code == 400


def test_shutdown_requires_auth_and_runs_after_response(tmp_path: Path) -> None:
    shutdown_calls: list[bool] = []
    client = make_client(tmp_path, lambda: shutdown_calls.append(True))

    unauthorized = client.post("/v1/runtime/shutdown")
    authorized = client.post(
        "/v1/runtime/shutdown",
        headers={"Authorization": "Bearer secret-token"},
    )

    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json() == {"shutting_down": True}
    assert shutdown_calls == [True]


def test_websocket_ticket_is_origin_bound_and_one_time(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    headers = {
        "Authorization": "Bearer secret-token",
        "Origin": "https://freecut.net",
    }
    response = client.post("/v1/events/ticket", headers=headers)

    assert response.status_code == 200
    ticket = response.json()["ticket"]
    with client.websocket_connect(
        f"/v1/events?ticket={ticket}", headers={"Origin": "https://freecut.net"}
    ) as websocket:
        event = websocket.receive_json()
        assert event["version"] == 1
        assert event["type"] == "runtime.connected"
        assert event["sequence"] > 0
        publisher = threading.Thread(
            target=lambda: client.app.state.event_broker.publish(
                "job.progress", {"progress": 0.5}, job_id="job-1"
            )
        )
        publisher.start()
        publisher.join()
        worker_event = websocket.receive_json()
        assert worker_event["type"] == "job.progress"
        assert worker_event["jobId"] == "job-1"

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/v1/events?ticket={ticket}",
            headers={"Origin": "https://freecut.net"},
        ):
            pass


def test_websocket_ticket_rejects_untrusted_origin(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.post(
        "/v1/events/ticket",
        headers={
            "Authorization": "Bearer secret-token",
            "Origin": "https://attacker.example",
        },
    )

    assert response.status_code == 403
