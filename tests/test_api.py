from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from call_driver.engine import MockBrain
from call_driver.main import app
from call_driver.store import SessionStore
import call_driver.main as main_module


client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_session_store(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "store", SessionStore(tmp_path))


def test_create_call_and_continue(monkeypatch) -> None:
    monkeypatch.setattr(main_module, "brain", MockBrain())
    created = client.post(
        "/api/sessions",
        json={
            "calling_on_behalf_of": "Zuo",
            "contact_name": "Alex",
            "phone_number": "+1 415 555 0100",
            "intention": "Ask to move an appointment to Tuesday morning",
            "success_definition": "A new time is confirmed",
        },
    )
    assert created.status_code == 201
    session = created.json()
    assert "AI assistant" in session["transcript"][0]["text"]
    assert "live transcription" in session["transcript"][0]["text"]

    turn = client.post(
        f'/api/sessions/{session["id"]}/turn', json={"text": "Yes, that's fine"}
    )
    assert turn.status_code == 200
    assert turn.json()["decision"]["status"] == "continue"
    assert turn.json()["session"]["status"] == "active"

    transcript = client.get(f'/api/sessions/{session["id"]}/transcript.txt')
    assert transcript.status_code == 200
    assert "RECIPIENT: Yes, that's fine" in transcript.text


def test_bad_phone_number_is_rejected() -> None:
    response = client.post(
        "/api/sessions",
        json={"intention": "Confirm the appointment time", "phone_number": "dial-me-now"},
    )
    assert response.status_code == 422
