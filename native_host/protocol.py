from __future__ import annotations

import json
import struct
import uuid
from base64 import b64decode, b64encode
from collections.abc import Iterable
from typing import Any, BinaryIO

DEFAULT_MAX_FRAME_BYTES = 900_000
DEFAULT_FRAGMENT_PAYLOAD_BYTES = 600_000
DEFAULT_MAX_MESSAGE_BYTES = DEFAULT_MAX_FRAME_BYTES


class MessageTooLargeError(ValueError):
    """Raised when a native message exceeds the configured safety limit."""


def to_json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): to_json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [to_json_safe(item) for item in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str | int | float | bool) or value is None:
        return value
    if hasattr(value, "handle"):
        return {"type": value.__class__.__name__, "handle": value.handle}
    return repr(value)


def encode_message(
    message: dict[str, Any],
    *,
    max_bytes: int = DEFAULT_MAX_FRAME_BYTES,
) -> bytes:
    payload = json.dumps(to_json_safe(message), separators=(",", ":")).encode("utf-8")
    if len(payload) > max_bytes:
        raise MessageTooLargeError(f"message is {len(payload)} bytes")
    return struct.pack("=I", len(payload)) + payload


def write_message(
    stream: BinaryIO,
    message: dict[str, Any],
    *,
    max_bytes: int = DEFAULT_MAX_FRAME_BYTES,
) -> None:
    stream.write(encode_message(message, max_bytes=max_bytes))
    stream.flush()


def read_message(
    stream: BinaryIO,
    *,
    max_bytes: int = DEFAULT_MAX_FRAME_BYTES,
) -> dict[str, Any]:
    header = stream.read(4)
    if header == b"":
        raise EOFError
    if len(header) != 4:
        raise EOFError("native message header is truncated")
    length = struct.unpack("=I", header)[0]
    if length > max_bytes:
        raise MessageTooLargeError(f"message is {length} bytes")
    payload = stream.read(length)
    if len(payload) != length:
        raise EOFError("native message payload is truncated")
    return json.loads(payload.decode("utf-8"))


def fragment_message(
    message: dict[str, Any],
    *,
    max_payload_bytes: int = DEFAULT_FRAGMENT_PAYLOAD_BYTES,
) -> list[dict[str, Any]]:
    payload = json.dumps(to_json_safe(message), separators=(",", ":")).encode("utf-8")
    if len(payload) <= max_payload_bytes:
        return [message]

    fragment_id = str(message.get("id") or uuid.uuid4())
    chunks = [
        payload[index : index + max_payload_bytes]
        for index in range(0, len(payload), max_payload_bytes)
    ]
    return [
        {
            "type": "fragment",
            "fragmentId": fragment_id,
            "index": index,
            "count": len(chunks),
            "payloadBase64": b64encode(chunk).decode("ascii"),
        }
        for index, chunk in enumerate(chunks)
    ]


def reassemble_fragments(fragments: Iterable[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(fragments, key=lambda item: item["index"])
    if not ordered:
        raise ValueError("no fragments")
    expected_count = ordered[0]["count"]
    fragment_id = ordered[0]["fragmentId"]
    if len(ordered) != expected_count:
        raise ValueError("missing fragments")
    if any(item["fragmentId"] != fragment_id for item in ordered):
        raise ValueError("mixed fragment ids")
    payload = b"".join(b64decode(item["payloadBase64"]) for item in ordered)
    return json.loads(payload.decode("utf-8"))


class FragmentReassembler:
    def __init__(self) -> None:
        self._pending: dict[str, dict[int, dict[str, Any]]] = {}

    def add(self, fragment: dict[str, Any]) -> dict[str, Any] | None:
        fragment_id = fragment["fragmentId"]
        parts = self._pending.setdefault(fragment_id, {})
        parts[fragment["index"]] = fragment
        if len(parts) != fragment["count"]:
            return None
        fragments = [parts[index] for index in range(fragment["count"])]
        del self._pending[fragment_id]
        return reassemble_fragments(fragments)
