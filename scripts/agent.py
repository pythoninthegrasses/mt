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
LASTFM_API_KEY = config("LASTFM_API_KEY", default="")
LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/"

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
- When you have enough tracks (10-25), respond with the final playlist

STRATEGY — pick the approach that fits the request:
- Mood/vibe requests ("chill", "upbeat", "sad", "energetic"):
  Start with get_top_artists_by_tag using Last.fm genre tags (e.g. chillout, downtempo, ambient, shoegaze, dream pop).
  Do NOT use search_library for mood words — it only matches title/artist/album text, not vibe.
  Use get_track_tags on candidate tracks to verify they match the mood.
- Artist-based requests ("similar to Radiohead", "like Bjork"):
  Use get_similar_artists and get_similar_tracks to find related music in the library.
- General/mixed requests:
  Use get_recently_played or get_top_artists to understand listening habits, then combine
  with get_similar_tracks, get_similar_artists, or get_top_artists_by_tag.
- Regional requests ("Japanese music", "Brazilian"):
  Use get_top_tracks_by_country.
- search_library is for finding specific tracks by artist name, album, or title keyword.

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
            "description": "Get mood and genre tags for a track. Use to understand a track's vibe.",
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
            "description": "Find tracks similar to a given track. Returns only tracks in the user's library.",
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
            "description": "Find artists similar to a given artist. Returns only artists in the user's library with sample tracks.",
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
            "description": "Find top artists in a genre/tag. Returns only artists in the user's library with sample tracks.",
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
            "description": "Find trending tracks in a country. Returns only tracks in the user's library.",
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


def _lastfm_get(method: str, **params) -> dict:
    """Make a Last.fm API GET request. Returns parsed JSON or empty dict on error."""
    if not LASTFM_API_KEY:
        return {}
    import httpx

    query = {"method": method, "api_key": LASTFM_API_KEY, "format": "json", **params}
    try:
        resp = httpx.get(LASTFM_BASE_URL, params=query, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            return {}
        return data
    except (httpx.HTTPError, ValueError):
        return {}


def _find_track_in_library(
    conn: sqlite3.Connection, artist: str, title: str
) -> list[dict]:
    """Find tracks matching artist + title in local library."""
    rows = conn.execute(
        """SELECT id, title, artist, album, genre FROM library
           WHERE artist LIKE ? AND title LIKE ? AND missing = 0 LIMIT 5""",
        (artist, title),
    ).fetchall()
    return [_track_row_to_summary(r) for r in rows]


def _find_artist_tracks(
    conn: sqlite3.Connection, artist: str, limit: int = 5
) -> list[dict]:
    """Find tracks by artist in local library."""
    rows = conn.execute(
        """SELECT id, title, artist, album, genre FROM library
           WHERE artist LIKE ? AND missing = 0 LIMIT ?""",
        (artist, limit),
    ).fetchall()
    return [_track_row_to_summary(r) for r in rows]


def tool_get_similar_tracks(conn: sqlite3.Connection, args: dict) -> list[dict]:
    """Find tracks similar to a given track via Last.fm, cross-ref with local library."""
    artist = args.get("artist", "")
    track = args.get("track", "")
    limit = args.get("limit", 10)

    data = _lastfm_get(
        "track.getSimilar", artist=artist, track=track, limit=limit, autocorrect=1
    )
    similar = data.get("similartracks", {}).get("track", [])
    if isinstance(similar, dict):
        similar = [similar]

    results = []
    for st in similar:
        st_artist = st.get("artist", {})
        artist_name = (
            st_artist.get("name", "") if isinstance(st_artist, dict) else str(st_artist)
        )
        st_title = st.get("name", "")
        results.extend(_find_track_in_library(conn, artist_name, st_title))
    return results


def tool_get_similar_artists(conn: sqlite3.Connection, args: dict) -> list[dict]:
    """Find similar artists via Last.fm, return their tracks from local library."""
    artist = args.get("artist", "")
    limit = args.get("limit", 10)

    data = _lastfm_get("artist.getSimilar", artist=artist, limit=limit, autocorrect=1)
    similar = data.get("similarartists", {}).get("artist", [])
    if isinstance(similar, dict):
        similar = [similar]

    results = []
    for sa in similar:
        sa_name = sa.get("name", "")
        tracks = _find_artist_tracks(conn, sa_name, limit=5)
        if tracks:
            results.append({"artist": sa_name, "sample_tracks": tracks})
    return results


def tool_get_track_tags(conn: sqlite3.Connection, args: dict) -> list[dict]:
    """Get mood/genre tags for a track from Last.fm."""
    artist = args.get("artist", "")
    track = args.get("track", "")

    data = _lastfm_get("track.getTopTags", artist=artist, track=track, autocorrect=1)
    tags = data.get("toptags", {}).get("tag", [])
    if isinstance(tags, dict):
        tags = [tags]

    return [{"name": t.get("name", ""), "count": t.get("count", 0)} for t in tags[:10]]


def tool_get_top_artists_by_tag(conn: sqlite3.Connection, args: dict) -> list[dict]:
    """Find top artists in a genre/tag via Last.fm, cross-ref with local library."""
    tag = args.get("tag", "")
    limit = args.get("limit", 10)

    data = _lastfm_get("tag.getTopArtists", tag=tag, limit=limit)
    artists = data.get("topartists", {}).get("artist", [])
    if isinstance(artists, dict):
        artists = [artists]

    results = []
    for ta in artists:
        ta_name = ta.get("name", "")
        tracks = _find_artist_tracks(conn, ta_name, limit=5)
        if tracks:
            results.append({"artist": ta_name, "sample_tracks": tracks})
    return results


def tool_get_top_tracks_by_country(conn: sqlite3.Connection, args: dict) -> list[dict]:
    """Find trending tracks in a country via Last.fm, cross-ref with local library."""
    country = args.get("country", "")
    limit = args.get("limit", 10)

    data = _lastfm_get("geo.getTopTracks", country=country, limit=limit)
    tracks = data.get("tracks", {}).get("track", [])
    if isinstance(tracks, dict):
        tracks = [tracks]

    results = []
    for gt in tracks:
        gt_artist = gt.get("artist", {})
        artist_name = (
            gt_artist.get("name", "") if isinstance(gt_artist, dict) else str(gt_artist)
        )
        gt_title = gt.get("name", "")
        results.extend(_find_track_in_library(conn, artist_name, gt_title))
    return results


TOOL_DISPATCH: dict[str, callable] = {
    "get_recently_played": tool_get_recently_played,
    "get_top_artists": tool_get_top_artists,
    "search_library": tool_search_library,
    "get_track_tags": tool_get_track_tags,
    "get_similar_tracks": tool_get_similar_tracks,
    "get_similar_artists": tool_get_similar_artists,
    "get_top_artists_by_tag": tool_get_top_artists_by_tag,
    "get_top_tracks_by_country": tool_get_top_tracks_by_country,
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
    think: bool = DEFAULT_THINK,
    temperature: float = DEFAULT_TEMPERATURE,
    log_file: str | Path = DEFAULT_LOG_FILE,
) -> None:
    _setup_logging(log_file)

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

    log.info(
        "session_start",
        extra={
            "data": {
                "model": model,
                "prompt": prompt,
                "max_turns": max_turns,
                "think": think,
                "temperature": temperature,
                "db_path": str(db_file),
                "track_count": track_count,
            }
        },
    )

    lastfm_status = "configured" if LASTFM_API_KEY else "not configured"
    print(f"\n{'=' * 60}")
    print(
        f"Model: {model} | Max turns: {max_turns} | Think: {think} | Temp: {temperature}"
    )
    print(f"Last.fm: {lastfm_status}")
    print(f"Prompt: {prompt}")
    print(f"{'=' * 60}\n")

    for turn in range(1, max_turns + 1):
        print(f"--- Turn {turn}/{max_turns} ---")
        log.info("turn_start", extra={"data": {"turn": turn}})

        kwargs: dict = {
            "model": model,
            "messages": messages,
            "tools": TOOLS,
            "options": {"temperature": temperature},
            "think": think,
        }

        response: ChatResponse = client.chat(**kwargs)
        msg = response.message

        if hasattr(msg, "thinking") and msg.thinking:
            print(f"\n<think>\n{msg.thinking}\n</think>")
            log.info("thinking", extra={"data": {"text": msg.thinking[:500]}})

        if msg.tool_calls:
            messages.append(msg)

            for tc in msg.tool_calls:
                name = tc.function.name
                args = tc.function.arguments
                print(f"  TOOL: {name}({json.dumps(args, separators=(',', ':'))})")
                log.info("tool_call", extra={"data": {"tool": name, "args": args}})

                handler = TOOL_DISPATCH.get(name)
                if not handler:
                    result = {"error": f"Unknown tool: {name}"}
                    log.error(
                        "tool_error",
                        extra={
                            "data": {"tool": name, "error": f"Unknown tool: {name}"}
                        },
                    )
                else:
                    try:
                        result = handler(conn, args)
                    except Exception as e:
                        result = {"error": str(e)}
                        log.error(
                            "tool_error",
                            extra={"data": {"tool": name, "error": str(e)}},
                        )

                result_str = json.dumps(result, default=str)
                if isinstance(result, list):
                    log.info(
                        "tool_result",
                        extra={
                            "data": {
                                "tool": name,
                                "count": len(result),
                                "result": result,
                            }
                        },
                    )
                else:
                    log.info(
                        "tool_result",
                        extra={
                            "data": {
                                "tool": name,
                                "result": result,
                            }
                        },
                    )
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
                    elif "artist" in result[0] and "sample_tracks" in result[0]:
                        lines = []
                        for r in result[:10]:
                            tracks = r.get("sample_tracks", [])
                            track_str = ", ".join(
                                t.get("title", "?") for t in tracks[:3]
                            )
                            lines.append(f"    {r.get('artist', '?')} ({track_str})")
                        tail = f"\n    ... and {count - 10} more" if count > 10 else ""
                        print(f"    -> {count} artists with library tracks:")
                        print("\n".join(lines) + tail)
                    elif "name" in result[0] and "count" in result[0]:
                        lines = [
                            f"    {r.get('name', '?')} ({r.get('count', 0)})"
                            for r in result[:10]
                        ]
                        print(f"    -> {count} tags:")
                        print("\n".join(lines))
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
            log.info("final_response", extra={"data": {"content": content}})
            print(f"\nFINAL RESPONSE:\n{textwrap.indent(content, '  ')}\n")

            parsed = parse_response(content)
            if parsed:
                pname, ids = parsed
                print(f"PARSED: Playlist='{pname}', Tracks={ids} ({len(ids)} tracks)")

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
                log.info(
                    "parse_success",
                    extra={
                        "data": {
                            "playlist_name": pname,
                            "track_ids": ids,
                            "valid_count": len(valid),
                        }
                    },
                )
            else:
                print(
                    "PARSE FAILED: Response did not match 'Playlist: ... / Tracks: ...' format"
                )
                print(
                    "(This is the bug -- the model didn't follow the expected format)"
                )
                log.info("parse_failure", extra={"data": {"content": content}})

            log.info(
                "session_end", extra={"data": {"reason": "success", "turns_used": turn}}
            )
            conn.close()
            return

    log.info(
        "session_end", extra={"data": {"reason": "exhausted", "turns_used": max_turns}}
    )
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
        default=DEFAULT_THINK,
        help="Enable extended thinking (qwen3 /think mode)",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=DEFAULT_TEMPERATURE,
        help=f"Sampling temperature (default: {DEFAULT_TEMPERATURE})",
    )
    parser.add_argument(
        "--log-file",
        default=DEFAULT_LOG_FILE,
        help=f"JSONL log file path (default: {DEFAULT_LOG_FILE})",
    )
    args = parser.parse_args()

    run_agent(
        args.prompt,
        model=args.model,
        host=args.host,
        max_turns=args.max_turns,
        db_path=args.db,
        think=args.think,
        temperature=args.temperature,
        log_file=args.log_file,
    )


if __name__ == "__main__":
    main()
