"""Tests never depend on the developer's private .env: no backup provider unless a test configures one."""
import pytest

import app as game


@pytest.fixture(autouse=True)
def hermetic_model_settings(monkeypatch):
    monkeypatch.setattr(game, "BACKUP_KEY", "")
    monkeypatch.setattr(game, "BACKUP_URL", "")
