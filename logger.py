"""Unified log format — readable in ./serve.sh logs

Format: HH:MM:SS.mmm  Model-Tag       action content

Usage:
    from logger import log, ok, err
    log("openai", "→ connect", "target=ru")
    ok("openai", f"← session ready ({elapsed:.0f}ms)")
    err("openai", "ws closed unexpectedly")
"""
import sys
import time

_C = {"r": "31", "g": "32", "y": "33", "b": "34", "m": "35", "c": "36", "gray": "90"}


def _c(color, s):
    return f"\033[{_C[color]}m{s}\033[0m"


TAGS = {
    "openai":    _c("g", "OpenAI-RT-Tx  ".ljust(14)),
    "ws":        _c("gray", "WS-Server     ".ljust(14)),
    "auth":      _c("c", "Auth          ".ljust(14)),
    "room":      _c("m", "Room          ".ljust(14)),
}


def _ts():
    t = time.time()
    return time.strftime("%H:%M:%S", time.localtime(t)) + f".{int((t - int(t)) * 1000):03d}"


def _emit(tag, marker, parts):
    label = TAGS.get(tag) or _c("gray", tag.ljust(14))
    msg = " ".join(str(p) for p in parts)
    line = f"{_c('gray', _ts())}  {label}  {marker}{msg}\n"
    sys.stdout.write(line)
    sys.stdout.flush()


def log(tag, *parts):
    _emit(tag, "", parts)


def ok(tag, *parts):
    _emit(tag, _c("g", "✓ "), parts)


def err(tag, *parts):
    _emit(tag, _c("r", "✗ "), parts)


def warn(tag, *parts):
    _emit(tag, _c("y", "⚠ "), parts)
