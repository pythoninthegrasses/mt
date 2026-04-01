#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.13,<3.14"
# dependencies = [
#     "httpx>=0.27,<1.0",
#     "ollama>=0.5",
#     "python-decouple>=3.8",
# ]
# [tool.uv]
# exclude-newer = "2026-04-30T00:00:00Z"
# ///

# pyright: reportMissingImports=false

"""Simulate the MT Genius agent loop against Ollama + local SQLite DB.

Replicates the Rust agent flow (system prompt, tool definitions, multi-turn
tool calling, response parsing) using the official Ollama Python library and
the mt.db SQLite database.

Usage:
    uv run scripts/agent.py "make me a chill playlist"
    uv run scripts/agent.py --model qwen3.5:9b "90s rock deep cuts"
    uv run scripts/agent.py --model qwen3.5:9b --think "jazz deep cuts"
    uv run scripts/agent.py --max-turns 3 "jazz from my library"
"""

import argparse
import json
import logging
import os
import platform
import sqlite3
import sys
import textwrap
import time
from datetime import datetime, timezone
from pathlib import Path

from ollama import Client, ChatResponse

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_FILE = SCRIPT_DIR.parent / ".env"

if ENV_FILE.exists():
    from decouple import Config, RepositoryEnv

    config = Config(RepositoryEnv(ENV_FILE))
else:
    from decouple import config

DEFAULT_MODEL = config("OLLAMA_MODEL", default="qwen3.5:9b")
OLLAMA_HOST = config("OLLAMA_HOST", default="http://localhost:11434")
MAX_TURNS = config("AGENT_MAX_TURNS", default=5, cast=int)
DEFAULT_LOG_FILE = config("AGENT_LOG_FILE", default="/tmp/ollama_python_agent.jsonl")
DEFAULT_TEMPERATURE = config("AGENT_TEMPERATURE", default=0.45, cast=float)
DEFAULT_THINK = config("AGENT_THINK", default=False, cast=bool)

log = logging.getLogger("agent")


class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "event": record.getMessage(),
        }
        if hasattr(record, "data"):
            entry["data"] = record.data
        return json.dumps(entry, default=str)


def _setup_logging(log_file: str | Path) -> None:
    handler = logging.FileHandler(log_file, mode="a", encoding="utf-8")
    handler.setFormatter(_JSONFormatter())
    log.addHandler(handler)
    log.setLevel(logging.DEBUG)


SYSTEM_PROMPT = """\
You are a playlist generator for a local music library. You create playlists by querying the user's library and Last.fm for similar music.

RULES:
- Only suggest tracks that exist in the user's library (returned by tools)
- Use get_recently_played or get_top_artists to understand listening habits
- Use get_similar_tracks or get_similar_artists to find complementary music
- Use search_library to find tracks by genre, artist, or keyword
- Use get_track_tags to understand a track's mood/genre tags
- Use get_top_artists_by_tag to discover artists in a genre the user owns but rarely plays
- Use get_top_tracks_by_country for regional discovery
- When you have enough tracks (10-25), respond with the final playlist

RESPONSE FORMAT (final answer only):
Playlist: [descriptive name]
Tracks: [comma-separated track IDs]

Only include track IDs you received from tool results. Never invent IDs."""


def _db_path() -> Path:
    """Resolve mt.db path based on platform."""
    if platform.system() == "Darwin":
        return (
            Path.home() / "Library" / "Application Support" / "com.mt.desktop" / "mt.db"
        )
    xdg = os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
    return Path(xdg) / "com.mt.desktop" / "mt.db"


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_recently_played",
            "description": "Get tracks the user played recently. Use to understand current listening habits.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Number of days to look back (default: 7)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max tracks to return (default: 20)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_artists",
            "description": "Get the user's most-played artists. Use to understand long-term preferences.",
            "parameters": {
                "type": "object",
                "properties": {
                    "range": {
                        "type": "string",
                        "description": "Time range: all_time, 7days, 30days, 90days, 180days, 365days (default: 30days)",
                        "enum": [
                            "all_time",
                            "7days",
                            "30days",
                            "90days",
                            "180days",
                            "365days",
                        ],
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max artists to return (default: 10)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_library",
            "description": "Search the user's music library by keyword, artist, or album. Returns matching tracks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Free-text search across title, artist, album",
                    },
                    "artist": {
                        "type": "string",
                        "description": "Filter by exact artist name",
                    },
                    "album": {
                        "type": "string",
                        "description": "Filter by exact album name",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max tracks to return (default: 20)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_track_tags",
            "description": "Get mood and genre tags for a track. Use to understand a track's vibe. (STUB: returns empty in simulation)",
            "parameters": {
                "type": "object",
                "properties": {
                    "artist": {"type": "string", "description": "Artist of the track"},
                    "track": {"type": "string", "description": "Title of the track"},
                },
                "required": ["artist", "track"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_similar_tracks",
            "description": "Find tracks similar to a given track. Returns only tracks in the user's library. (STUB: returns empty in simulation)",
            "parameters": {
                "type": "object",
                "properties": {
                    "artist": {
                        "type": "string",
                        "description": "Artist of the seed track",
                    },
                    "track": {
                        "type": "string",
                        "description": "Title of the seed track",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max similar tracks to fetch (default: 10)",
                    },
                },
                "required": ["artist", "track"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_similar_artists",
            "description": "Find artists similar to a given artist. Returns only artists in the user's library with sample tracks. (STUB: returns empty in simulation)",
            "parameters": {
                "type": "object",
                "properties": {
                    "artist": {
                        "type": "string",
                        "description": "Artist to find similar artists for",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max similar artists to fetch (default: 10)",
                    },
                },
                "required": ["artist"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_artists_by_tag",
            "description": "Find top artists in a genre/tag. Returns only artists in the user's library with sample tracks. (STUB: returns empty in simulation)",
            "parameters": {
                "type": "object",
                "properties": {
                    "tag": {
                        "type": "string",
                        "description": "Genre or tag (e.g. shoegaze, jazz, indie rock)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max artists to fetch (default: 10)",
                    },
                },
                "required": ["tag"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_tracks_by_country",
            "description": "Find trending tracks in a country. Returns only tracks in the user's library. (STUB: returns empty in simulation)",
            "parameters": {
                "type": "object",
                "properties": {
                    "country": {
                        "type": "string",
                        "description": "Country name (e.g. Japan, Brazil, Germany)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max tracks to fetch (default: 10)",
                    },
                },
                "required": ["country"],
            },
        },
    },
]


def _track_row_to_summary(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"] or "",
        "artist": row["artist"] or "",
        "album": row["album"],
        "genre": row["genre"],
    }


def tool_get_recently_played(conn: sqlite3.Connection, args: dict) -> list[dict]:
    days = args.get("days", 7)
    limit = args.get("limit", 20)
    rows = conn.execute(
        """SELECT id, title, artist, album, genre FROM library
           WHERE last_played >= datetime('now', ?) AND missing = 0
           ORDER BY last_played DESC LIMIT ?""",
        (f"-{days} days", limit),
    ).fetchall()
    return [_track_row_to_summary(r) for r in rows]


def tool_get_top_artists(conn: sqlite3.Connection, args: dict) -> list[dict]:
    range_str = args.get("range", "30days")
    limit = args.get("limit", 10)
    range_map = {
        "all_time": "-100 years",
        "7days": "-7 days",
        "30days": "-30 days",
        "90days": "-90 days",
        "180days": "-180 days",
        "365days": "-365 days",
    }
    interval = range_map.get(range_str, "-30 days")
    rows = conn.execute(
        """SELECT artist, COUNT(*) as play_count
           FROM play_history ph JOIN library l ON ph.track_id = l.id
           WHERE ph.played_at >= datetime('now', ?) AND l.missing = 0
           GROUP BY l.artist ORDER BY play_count DESC LIMIT ?""",
        (interval, limit),
    ).fetchall()
    return [{"artist": r["artist"], "play_count": r["play_count"]} for r in rows]


def tool_search_library(conn: sqlite3.Connection, args: dict) -> list[dict]:
    limit = args.get("limit", 20)
    query = args.get("query")
    artist = args.get("artist")
    album = args.get("album")

    conditions = ["missing = 0"]
    params: list = []

    if query:
        conditions.append("(title LIKE ? OR artist LIKE ? OR album LIKE ?)")
        like = f"%{query}%"
        params.extend([like, like, like])
    if artist:
        conditions.append("artist = ?")
        params.append(artist)
    if album:
        conditions.append("album = ?")
        params.append(album)

    where = " AND ".join(conditions)
    params.append(limit)
    rows = conn.execute(
        f"SELECT id, title, artist, album, genre FROM library WHERE {where} LIMIT ?",
        params,
    ).fetchall()
    return [_track_row_to_summary(r) for r in rows]


def tool_stub(_conn: sqlite3.Connection, _args: dict) -> list:
    """Stub for Last.fm-dependent tools. Returns empty -- model must use local tools."""
    return []


TOOL_DISPATCH: dict[str, callable] = {
    "get_recently_played": tool_get_recently_played,
    "get_top_artists": tool_get_top_artists,
    "search_library": tool_search_library,
    "get_track_tags": tool_stub,
    "get_similar_tracks": tool_stub,
    "get_similar_artists": tool_stub,
    "get_top_artists_by_tag": tool_stub,
    "get_top_tracks_by_country": tool_stub,
}


def parse_response(text: str) -> tuple[str, list[int]] | None:
    """Parse 'Playlist: ...\\nTracks: ...' from agent text. Returns (name, ids) or None."""
    name = None
    track_ids = []
    for line in text.splitlines():
        if line.startswith("Playlist:"):
            name = line[len("Playlist:") :].strip()
        elif line.startswith("Tracks:"):
            raw = line[len("Tracks:") :].strip().strip("[]")
            for tok in raw.split(","):
                tok = tok.strip().strip("[]")
                if tok.isdigit():
                    track_ids.append(int(tok))
    if name and track_ids:
        return name, track_ids
    return None


def run_agent(
    prompt: str,
    *,
    model: str = DEFAULT_MODEL,
    host: str = OLLAMA_HOST,
    max_turns: int = MAX_TURNS,
    db_path: Path | None = None,
    think: bool = False,
) -> None:
    db_file = db_path or _db_path()
    if not db_file.exists():
        print(f"ERROR: Database not found at {db_file}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(str(db_file))
    conn.row_factory = sqlite3.Row

    track_count = conn.execute(
        "SELECT COUNT(*) FROM library WHERE missing = 0"
    ).fetchone()[0]
    print(f"Connected to {db_file} ({track_count} tracks)")

    client = Client(host=host, timeout=120.0)

    available = [m.model for m in client.list().models]
    if not any(
        m == model or m.startswith(model.split(":")[0] + ":") for m in available
    ):
        print(
            f"ERROR: Model '{model}' not found. Available: {', '.join(available)}",
            file=sys.stderr,
        )
        sys.exit(1)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    print(f"\n{'=' * 60}")
    print(f"Model: {model} | Max turns: {max_turns} | Think: {think}")
    print(f"Prompt: {prompt}")
    print(f"{'=' * 60}\n")

    for turn in range(1, max_turns + 1):
        print(f"--- Turn {turn}/{max_turns} ---")

        kwargs: dict = {
            "model": model,
            "messages": messages,
            "tools": TOOLS,
        }
        if think:
            kwargs["think"] = True

        response: ChatResponse = client.chat(**kwargs)
        msg = response.message

        if hasattr(msg, "thinking") and msg.thinking:
            print(f"\n<think>\n{msg.thinking}\n</think>")

        if msg.tool_calls:
            messages.append(msg)

            for tc in msg.tool_calls:
                name = tc.function.name
                args = tc.function.arguments
                print(f"  TOOL: {name}({json.dumps(args, separators=(',', ':'))})")

                handler = TOOL_DISPATCH.get(name, tool_stub)
                try:
                    result = handler(conn, args)
                except Exception as e:
                    result = {"error": str(e)}

                result_str = json.dumps(result, default=str)
                if isinstance(result, list) and result:
                    count = len(result)
                    if "artist" in result[0] and "title" in result[0]:
                        lines = [
                            f"    {r.get('artist', '?')} - {r.get('title', '?')}"
                            for r in result[:10]
                        ]
                        tail = f"\n    ... and {count - 10} more" if count > 10 else ""
                        print(f"    -> {count} tracks:")
                        print("\n".join(lines) + tail)
                    elif "artist" in result[0] and "play_count" in result[0]:
                        lines = [
                            f"    {r.get('artist', '?')} ({r.get('play_count', 0)} plays)"
                            for r in result[:10]
                        ]
                        tail = f"\n    ... and {count - 10} more" if count > 10 else ""
                        print(f"    -> {count} artists:")
                        print("\n".join(lines) + tail)
                    else:
                        display = (
                            result_str[:200] + "..."
                            if len(result_str) > 200
                            else result_str
                        )
                        print(f"    -> {count} results: {display}")
                elif isinstance(result, list):
                    print("    -> 0 results: []")
                else:
                    display = (
                        result_str[:200] + "..."
                        if len(result_str) > 200
                        else result_str
                    )
                    print(f"    -> {display}")

                messages.append(
                    {
                        "role": "tool",
                        "content": result_str,
                        "tool_name": name,
                    }
                )
        else:
            content = msg.content or ""
            print(f"\nFINAL RESPONSE:\n{textwrap.indent(content, '  ')}\n")

            parsed = parse_response(content)
            if parsed:
                name, ids = parsed
                print(f"PARSED: Playlist='{name}', Tracks={ids} ({len(ids)} tracks)")

                placeholders = ",".join("?" * len(ids))
                valid = conn.execute(
                    f"SELECT id, title, artist FROM library WHERE id IN ({placeholders})",
                    ids,
                ).fetchall()
                print(f"VALID:  {len(valid)}/{len(ids)} track IDs exist in library")
                for t in valid[:10]:
                    print(f"  [{t['id']}] {t['artist']} - {t['title']}")
                if len(valid) > 10:
                    print(f"  ... and {len(valid) - 10} more")
            else:
                print(
                    "PARSE FAILED: Response did not match 'Playlist: ... / Tracks: ...' format"
                )
                print(
                    "(This is the bug -- the model didn't follow the expected format)"
                )

            conn.close()
            return

    print(f"\nWARNING: Exhausted {max_turns} turns without a final response.")
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Simulate MT Genius agent against Ollama + mt.db",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            examples:
              uv run scripts/agent.py "make me a chill playlist"
              uv run scripts/agent.py --model llama3.2:1b "90s rock"
              uv run scripts/agent.py --model qwen3.5:9b --think "jazz deep cuts"
              uv run scripts/agent.py --max-turns 3 "upbeat workout mix"
        """),
    )
    parser.add_argument("prompt", help="Natural language playlist prompt")
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Ollama model (default: {DEFAULT_MODEL})",
    )
    parser.add_argument("--host", default=OLLAMA_HOST, help="Ollama host URL")
    parser.add_argument(
        "--max-turns",
        type=int,
        default=MAX_TURNS,
        help=f"Max agent turns (default: {MAX_TURNS})",
    )
    parser.add_argument(
        "--db", type=Path, default=None, help="Path to mt.db (auto-detected)"
    )
    parser.add_argument(
        "--think",
        action="store_true",
        help="Enable extended thinking (qwen3 /think mode)",
    )
    args = parser.parse_args()

    run_agent(
        args.prompt,
        model=args.model,
        host=args.host,
        max_turns=args.max_turns,
        db_path=args.db,
        think=args.think,
    )


if __name__ == "__main__":
    main()
