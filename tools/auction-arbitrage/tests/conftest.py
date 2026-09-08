import socket
import threading
import time

import pytest
import uvicorn

from tests.mock_hibid import build


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def mock_hibid():
    port = _free_port()
    app = build()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield {"url": f"http://127.0.0.1:{port}/graphql", "site": f"http://127.0.0.1:{port}", "app": app}
    server.should_exit = True


@pytest.fixture
def settings(tmp_path, mock_hibid, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("ARB_HIBID_GRAPHQL", mock_hibid["url"])
    monkeypatch.setenv("ARB_HIBID_SITE", mock_hibid["site"])
    monkeypatch.setenv("ARB_DB", str(tmp_path / "t.sqlite3"))
    monkeypatch.setenv("ARB_EBAY_SOLD", "0")
    monkeypatch.setenv("ARB_REQUEST_DELAY", "0")
    from arb.config import load
    return load()
