"""backend.db – in-memory detection history."""
from .database import record_history, query_history, MAX_HISTORY

__all__ = ["record_history", "query_history", "MAX_HISTORY"]
