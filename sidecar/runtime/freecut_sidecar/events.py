from __future__ import annotations

import asyncio
import secrets
import threading
from dataclasses import dataclass
from time import monotonic, time
from typing import Any


@dataclass(frozen=True)
class EventSubscription:
    id: int
    queue: asyncio.Queue[dict[str, Any]]


class EventBroker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sequence = 0
        self._next_subscription_id = 0
        self._subscriptions: dict[
            int, tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]
        ] = {}

    def subscribe(self) -> EventSubscription:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=128)
        with self._lock:
            self._next_subscription_id += 1
            subscription_id = self._next_subscription_id
            self._subscriptions[subscription_id] = (loop, queue)
        return EventSubscription(subscription_id, queue)

    def unsubscribe(self, subscription_id: int) -> None:
        with self._lock:
            self._subscriptions.pop(subscription_id, None)

    def publish(
        self,
        event_type: str,
        payload: dict[str, Any],
        *,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            self._sequence += 1
            event = {
                "version": 1,
                "sequence": self._sequence,
                "type": event_type,
                "timestamp": int(time() * 1000),
                "jobId": job_id,
                "payload": payload,
            }
            subscriptions = list(self._subscriptions.values())

        for loop, queue in subscriptions:
            loop.call_soon_threadsafe(self._enqueue, queue, event)
        return event

    @staticmethod
    def _enqueue(queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(event)


class WebSocketTicketStore:
    def __init__(self, ttl_seconds: float = 30.0) -> None:
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._tickets: dict[str, tuple[float, str]] = {}

    @property
    def ttl_seconds(self) -> float:
        return self._ttl_seconds

    def issue(self, origin: str) -> str:
        ticket = secrets.token_urlsafe(32)
        now = monotonic()
        with self._lock:
            self._remove_expired(now)
            self._tickets[ticket] = (now + self._ttl_seconds, origin)
        return ticket

    def consume(self, ticket: str, origin: str) -> bool:
        now = monotonic()
        with self._lock:
            self._remove_expired(now)
            entry = self._tickets.pop(ticket, None)
        return bool(
            entry and entry[0] >= now and secrets.compare_digest(entry[1], origin)
        )

    def _remove_expired(self, now: float) -> None:
        expired = [
            ticket for ticket, (expiry, _) in self._tickets.items() if expiry < now
        ]
        for ticket in expired:
            self._tickets.pop(ticket, None)
