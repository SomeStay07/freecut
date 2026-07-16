from __future__ import annotations

import argparse

import uvicorn

from .app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="FreeCut Local inference service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=43117)
    args = parser.parse_args()

    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        parser.error("FreeCut Local may only bind to a loopback address")

    server: uvicorn.Server

    def request_shutdown() -> None:
        server.should_exit = True

    config = uvicorn.Config(
        create_app(shutdown_callback=request_shutdown),
        host=args.host,
        port=args.port,
        log_level="info",
    )
    server = uvicorn.Server(config)
    server.run()


if __name__ == "__main__":
    main()
