"""
Pytest configuration and shared fixtures for Entity X tests.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Ensure backend is importable
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def temp_db_path():
    """Create a temporary database path for tests."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = f.name
    yield path
    # Cleanup
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.fixture
def sample_human_text():
    """Sample human-written text for testing."""
    return """
    The quick brown fox jumped over the lazy dog. This is a simple sentence 
    written by a human writer with natural variations in style and structure.
    The weather today is quite pleasant, with a gentle breeze coming from 
    the west. I remember when I was young, my grandmother used to tell me 
    stories about the old days. Those memories are precious to me.
    """


@pytest.fixture
def sample_ai_text():
    """Sample AI-like generated text for testing."""
    return """
    In the realm of contemporary discourse, it is imperative to acknowledge 
    the multifaceted nature of technological advancement. The paradigm shift 
    we are witnessing in artificial intelligence represents a transformative 
    epoch in human civilization. As we navigate the complexities of this 
    digital landscape, it becomes increasingly evident that the intersection 
    of technology and society necessitates careful consideration of ethical 
    implications. Furthermore, the proliferation of machine learning algorithms 
    has engendered unprecedented opportunities for innovation across diverse 
    sectors. It is worth noting that the integration of AI systems into 
    daily life has profound implications for workforce dynamics and economic 
    structures.
    """


@pytest.fixture
def sample_short_text():
    """Sample short text (below minimum for analysis)."""
    return "This is too short."
