import io
import json
import struct

import pytest

from native_host.protocol import (
    DEFAULT_MAX_FRAME_BYTES,
    FragmentReassembler,
    MessageTooLargeError,
    encode_message,
    fragment_message,
    read_message,
    reassemble_fragments,
    to_json_safe,
    write_message,
)


def test_native_message_round_trip() -> None:
    stream = io.BytesIO()

    write_message(stream, {"type": "ping", "value": 3})
    stream.seek(0)

    assert read_message(stream) == {"type": "ping", "value": 3}


def test_read_message_rejects_truncated_payload() -> None:
    payload = json.dumps({"type": "ping"}).encode()
    stream = io.BytesIO(struct.pack("=I", len(payload) + 1) + payload)

    with pytest.raises(EOFError):
        read_message(stream)


def test_encode_message_rejects_oversized_payload() -> None:
    with pytest.raises(MessageTooLargeError):
        encode_message({"blob": "x" * 80}, max_bytes=32)


def test_read_message_rejects_oversized_payload() -> None:
    payload = json.dumps({"blob": "x" * 80}).encode()
    stream = io.BytesIO(struct.pack("=I", len(payload)) + payload)

    with pytest.raises(MessageTooLargeError):
        read_message(stream, max_bytes=32)


def test_fragmented_messages_reassemble() -> None:
    message = {"id": "one", "type": "large", "blob": "abcdef" * 20}
    fragments = fragment_message(message, max_payload_bytes=32)

    assert len(fragments) > 1
    assert reassemble_fragments(fragments) == message


def test_fragment_reassembler_handles_interleaved_messages() -> None:
    first = fragment_message(
        {"id": "a", "type": "large", "blob": "a" * 80}, max_payload_bytes=32
    )
    second = fragment_message(
        {"id": "b", "type": "large", "blob": "b" * 80}, max_payload_bytes=32
    )
    reassembler = FragmentReassembler()

    assert reassembler.add(first[0]) is None
    assert reassembler.add(second[0]) is None
    for fragment in first[1:-1]:
        assert reassembler.add(fragment) is None
    result = reassembler.add(first[-1])

    assert result == {"id": "a", "type": "large", "blob": "a" * 80}
    for fragment in second[1:-1]:
        assert reassembler.add(fragment) is None

    assert reassembler.add(second[-1]) == {
        "id": "b",
        "type": "large",
        "blob": "b" * 80,
    }


def test_default_fragments_fit_native_message_limit() -> None:
    fragments = fragment_message(
        {"id": "large-default", "type": "large", "blob": "x" * 1_400_000}
    )

    assert len(fragments) > 1
    for fragment in fragments:
        encoded = encode_message(fragment, max_bytes=DEFAULT_MAX_FRAME_BYTES)
        assert len(encoded) <= DEFAULT_MAX_FRAME_BYTES + 4


def test_to_json_safe_converts_remote_handles() -> None:
    class Remote:
        handle = 1000

    assert to_json_safe({"window": Remote(), "value": b"abc"}) == {
        "window": {"handle": 1000, "type": "Remote"},
        "value": "abc",
    }
