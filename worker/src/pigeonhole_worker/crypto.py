"""AES-256-GCM token encryption, wire-compatible with web/lib/crypto.

Packed format: iv (12 bytes) || auth tag (16 bytes) || ciphertext. The web app
encrypts tokens on sign-in; the worker decrypts them for background sync. Both
sides share TOKEN_ENCRYPTION_KEY (32-byte base64).
"""

from __future__ import annotations

import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_LENGTH = 12
TAG_LENGTH = 16
KEY_LENGTH = 32


def key_from_env() -> bytes:
    """Read and validate the 32-byte base64 key from TOKEN_ENCRYPTION_KEY."""
    import base64

    raw = os.environ.get("TOKEN_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is not set (generate with: openssl rand -base64 32)"
        )
    key = base64.b64decode(raw)
    if len(key) != KEY_LENGTH:
        raise RuntimeError("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes")
    return key


def encrypt_token(plaintext: str, key: bytes) -> bytes:
    iv = os.urandom(IV_LENGTH)
    sealed = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), None)
    # AESGCM appends the 16-byte tag to the ciphertext; repack as iv||tag||ct.
    ciphertext, tag = sealed[:-TAG_LENGTH], sealed[-TAG_LENGTH:]
    return iv + tag + ciphertext


def decrypt_token(packed: bytes, key: bytes) -> str:
    if len(packed) < IV_LENGTH + TAG_LENGTH:
        raise ValueError("Encrypted payload is too short to be valid")
    iv = packed[:IV_LENGTH]
    tag = packed[IV_LENGTH : IV_LENGTH + TAG_LENGTH]
    ciphertext = packed[IV_LENGTH + TAG_LENGTH :]
    plaintext = AESGCM(key).decrypt(iv, ciphertext + tag, None)
    return plaintext.decode("utf-8")
