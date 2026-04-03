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
the mt.db SQLite database. After generating a playlist, runs an LLM-as-judge
evaluation scoring concept match, instruction following, and track variety.

Usage:
    uv run scripts/agent.py "make me a chill playlist"
    uv run scripts/agent.py --model qwen3.5:9b "90s rock deep cuts"
    uv run scripts/agent.py --model qwen3.5:9b --think "jazz deep cuts"
    uv run scripts/agent.py --repeat-penalty 1.2 --temperature 0.4 "upbeat workout mix"
"""

import argparse
import json
import logging
import os
import platform
import re
import sqlite3
import sys
import textwrap
from datetime import datetime, timezone
from ollama import Client, ChatResponse
from pathlib import Path


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
DEFAULT_TEMPERATURE = config("AGENT_TEMPERATURE", default=0.3, cast=float)
DEFAULT_THINK = config("AGENT_THINK", default=False, cast=bool)
DEFAULT_SEED = config("AGENT_SEED", default=0, cast=int)
DEFAULT_REPEAT_PENALTY = config("AGENT_REPEAT_PENALTY", default=1.1, cast=float)
MIN_PLAYLIST_TRACKS = config("AGENT_MIN_PLAYLIST_TRACKS", default=12, cast=int)
MAX_PLAYLIST_TRACKS = config("AGENT_MAX_PLAYLIST_TRACKS", default=25, cast=int)
LASTFM_API_KEY = config("LASTFM_API_KEY", default="")
PROMPT_OVERRIDE = config("PROMPT", default="")
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


def _build_system_prompt(min_tracks: int, max_tracks: int) -> str:
    default_prompt = f"""\
You are a playlist generator for a local music library. You create playlists by querying the user's library and Last.fm for similar music.

RULES:
- Only suggest tracks that exist in the user's library (returned by tools)
- Return {min_tracks}-{max_tracks} track IDs in the final playlist. Never more than {max_tracks}. Curate, don't dump
- DEFAULT to 1 track per artist for MAXIMUM variety
- Only add a 2nd track from same artist if you CANNOT find enough unique artists to meet {min_tracks}
- PRIORITY: 20 tracks from 20 different artists > 20 tracks from 10 artists with 2 each
- A playlist should feel like a JOURNEY through different artists, not an artist deep dive
- When compiling: pick the BEST track from each artist, then move on
- As soon as you have {min_tracks}+ tracks from varied artists, output the playlist immediately
- Be CONCISE: do NOT list all discovered tracks in your response, just output Playlist: and Tracks:
- You have LIMITED turns. Call MULTIPLE tools PER TURN in PARALLEL. Do not waste turns on sequential calls
- When planning your strategy, call ALL independent tools at once (e.g. get_similar_artists + search_library + get_track_tags together)
- Do NOT call search_library for artists you already have sample tracks for — use those sample track IDs directly
- Read hint messages in tool results — they tell you what to try next

STRATEGY — pick the approach that fits the request:
- Mood/vibe requests ("chill", "upbeat", "sad", "energetic"):
  Call get_top_artists_by_tag with 2-3 genre tags IN PARALLEL (e.g. chillout + dream pop + shoegaze).
  Use limit=50 to cast a wide net. Do NOT use search_library for mood words — it only matches text, not vibe.
  Then use get_similar_tracks on the best matches to expand the playlist.
- Artist-based requests ("similar to Radiohead", "like Bjork"):
  Call get_similar_artists AND search_library(artist=...) in parallel on the first turn.
  Then use get_similar_tracks on seed tracks to expand.
- General/mixed requests:
  Use get_recently_played or get_top_artists to understand listening habits, then combine
  with get_similar_tracks, get_similar_artists, or get_top_artists_by_tag.
- Regional requests ("Japanese music", "Brazilian"):
  Use get_top_tracks_by_country with limit=50.
- search_library is for finding specific tracks by artist name, album, or title keyword.
- Use get_track_tags to understand a track's mood/genre before expanding with get_top_artists_by_tag.

RESPONSE FORMAT (final answer only):
Playlist: [descriptive name]
Tracks: [comma-separated track IDs]

PLAYLIST NAMING:
- Use a creative synonym or evocative phrase, not the user's exact words
- "chill" -> "Midnight Drift", "Velvet Haze", "Slow Burn Frequencies"
- "upbeat" -> "Solar Flare", "Electric Momentum", "Daybreak Drive"
- "sad" -> "Rain on Glass", "Quiet Ache", "Blue Hour Confessions"
- Capture the FEELING, don't parrot the request

Only include track IDs you received from tool results. Never invent IDs."""

    if PROMPT_OVERRIDE:
        return PROMPT_OVERRIDE.replace("{min_tracks}", str(min_tracks)).replace(
            "{max_tracks}", str(max_tracks)
        )

    return default_prompt


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
                        "description": "Max similar tracks to check (default: 30)",
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
                        "description": "Max similar artists to check (default: 30)",
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
                        "description": "Max artists to check (default: 50)",
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
                        "description": "Max tracks to check (default: 50)",
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


def tool_get_recently_played(conn: sqlite3.Connection, args: dict) -> list[dict] | dict:
    days = args.get("days", 7)
    limit = args.get("limit", 20)
    rows = conn.execute(
        """SELECT id, title, artist, album, genre FROM library
           WHERE last_played >= datetime('now', ?) AND missing = 0
           ORDER BY last_played DESC LIMIT ?""",
        (f"-{days} days", limit),
    ).fetchall()
    if not rows:
        return {
            "matches": 0,
            "hint": f"No tracks played in the last {days} days. "
            "Try a longer range (e.g. days=30), or use get_top_artists "
            "with range='all_time' to see long-term preferences.",
        }
    return [_track_row_to_summary(r) for r in rows]


def tool_get_top_artists(conn: sqlite3.Connection, args: dict) -> list[dict] | dict:
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
    if not rows:
        broader = {"7days": "30days", "30days": "90days", "90days": "all_time"}
        suggestion = broader.get(range_str)
        if suggestion:
            return {
                "matches": 0,
                "hint": f"No play history in range '{range_str}'. "
                f"Try range='{suggestion}' for a broader window, or skip "
                "to get_top_artists_by_tag with genre tags.",
            }
        return {
            "matches": 0,
            "hint": "No play history found. Use get_top_artists_by_tag with "
            "genre tags, or search_library to explore the collection directly.",
        }
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


def _lastfm_get(method: str, **params) -> dict | None:
    """Make a Last.fm API GET request. Returns parsed JSON, or None on error."""
    if not LASTFM_API_KEY:
        return None
    import httpx

    query = {"method": method, "api_key": LASTFM_API_KEY, "format": "json", **params}
    try:
        resp = httpx.get(LASTFM_BASE_URL, params=query, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            return None
        return data
    except (httpx.HTTPError, ValueError):
        return None


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
    conn: sqlite3.Connection, artist: str, limit: int = 2
) -> list[dict]:
    """Find tracks by artist in local library."""
    rows = conn.execute(
        """SELECT id, title, artist, album, genre FROM library
           WHERE artist LIKE ? AND missing = 0 LIMIT ?""",
        (artist, limit),
    ).fetchall()
    return [_track_row_to_summary(r) for r in rows]


def tool_get_similar_tracks(conn: sqlite3.Connection, args: dict) -> list[dict] | dict:
    """Find tracks similar to a given track via Last.fm, cross-ref with local library."""
    artist = args.get("artist", "")
    track = args.get("track", "")
    limit = args.get("limit", 30)

    data = _lastfm_get(
        "track.getSimilar", artist=artist, track=track, limit=limit, autocorrect=1
    )
    if data is None:
        return {
            "matches": 0,
            "hint": "Last.fm API unavailable. Try get_similar_artists or "
            "get_top_artists_by_tag instead.",
        }

    similar = data.get("similartracks", {}).get("track", [])
    if isinstance(similar, dict):
        similar = [similar]

    if not similar:
        return {
            "matches": 0,
            "lastfm_count": 0,
            "hint": f"Last.fm has no similar tracks for '{artist} - {track}'. "
            "Try get_similar_artists for broader matching, or search_library "
            "to find tracks by this artist.",
        }

    results = []
    for st in similar:
        st_artist = st.get("artist", {})
        artist_name = (
            st_artist.get("name", "") if isinstance(st_artist, dict) else str(st_artist)
        )
        st_title = st.get("name", "")
        results.extend(_find_track_in_library(conn, artist_name, st_title))

    if not results:
        lastfm_artists = {
            (
                st.get("artist", {}).get("name", "")
                if isinstance(st.get("artist", {}), dict)
                else str(st.get("artist", ""))
            )
            for st in similar[:5]
        }
        return {
            "matches": 0,
            "lastfm_count": len(similar),
            "hint": f"Last.fm returned {len(similar)} similar tracks but none are in "
            f"your library. Similar artists include: {', '.join(lastfm_artists)}. "
            "Try get_similar_artists or get_top_artists_by_tag instead.",
        }
    return results


def tool_get_similar_artists(conn: sqlite3.Connection, args: dict) -> list[dict] | dict:
    """Find similar artists via Last.fm, return their tracks from local library."""
    artist = args.get("artist", "")
    limit = args.get("limit", 30)

    data = _lastfm_get("artist.getSimilar", artist=artist, limit=limit, autocorrect=1)
    if data is None:
        return {
            "matches": 0,
            "hint": "Last.fm API unavailable. Try search_library with artist name, "
            "or get_top_artists_by_tag with a genre tag.",
        }

    similar = data.get("similarartists", {}).get("artist", [])
    if isinstance(similar, dict):
        similar = [similar]

    if not similar:
        return {
            "matches": 0,
            "lastfm_count": 0,
            "hint": f"Last.fm has no similar artists for '{artist}'. "
            "Try get_top_artists_by_tag with a genre tag, or search_library.",
        }

    results = []
    for sa in similar:
        sa_name = sa.get("name", "")
        tracks = _find_artist_tracks(conn, sa_name, limit=5)
        if tracks:
            results.append({"artist": sa_name, "sample_tracks": tracks})

    if not results:
        lastfm_names = [sa.get("name", "") for sa in similar[:5]]
        return {
            "matches": 0,
            "lastfm_count": len(similar),
            "hint": f"Last.fm returned {len(similar)} similar artists but none are in "
            f"your library. They include: {', '.join(lastfm_names)}. "
            "Try get_top_artists_by_tag with a genre tag for broader discovery.",
        }
    return results


def tool_get_track_tags(conn: sqlite3.Connection, args: dict) -> list[dict] | dict:
    """Get mood/genre tags for a track from Last.fm."""
    artist = args.get("artist", "")
    track = args.get("track", "")

    data = _lastfm_get("track.getTopTags", artist=artist, track=track, autocorrect=1)
    if data is None:
        return {
            "matches": 0,
            "hint": "Last.fm API unavailable. Try get_top_artists_by_tag with "
            "a genre guess, or get_similar_tracks to find related music.",
        }

    tags = data.get("toptags", {}).get("tag", [])
    if isinstance(tags, dict):
        tags = [tags]

    if not tags:
        return {
            "matches": 0,
            "hint": f"No tags on Last.fm for '{artist} - {track}'. This track may be "
            "too obscure. Try get_track_tags on a more popular track by this artist, "
            "or use get_similar_artists to explore related music.",
        }
    return [{"name": t.get("name", ""), "count": t.get("count", 0)} for t in tags[:10]]


def tool_get_top_artists_by_tag(
    conn: sqlite3.Connection, args: dict
) -> list[dict] | dict:
    """Find top artists in a genre/tag via Last.fm, cross-ref with local library."""
    tag = args.get("tag", "")
    limit = args.get("limit", 50)

    data = _lastfm_get("tag.getTopArtists", tag=tag, limit=limit)
    if data is None:
        return {
            "matches": 0,
            "hint": "Last.fm API unavailable. Try search_library with artist or "
            "album keywords instead.",
        }

    artists = data.get("topartists", {}).get("artist", [])
    if isinstance(artists, dict):
        artists = [artists]

    if not artists:
        return {
            "matches": 0,
            "lastfm_count": 0,
            "hint": f"No artists on Last.fm for tag '{tag}'. Try a broader or "
            "alternative tag name (e.g. 'electronic' instead of 'electronica', "
            "'indie rock' instead of 'indie').",
        }

    results = []
    for ta in artists:
        ta_name = ta.get("name", "")
        tracks = _find_artist_tracks(conn, ta_name, limit=5)
        if tracks:
            results.append({"artist": ta_name, "sample_tracks": tracks})

    if not results:
        lastfm_names = [ta.get("name", "") for ta in artists[:5]]
        return {
            "matches": 0,
            "lastfm_count": len(artists),
            "hint": f"Last.fm returned {len(artists)} artists for '{tag}' but none "
            f"are in your library. They include: {', '.join(lastfm_names)}. "
            "Try a broader tag, or use get_similar_artists on an artist you've "
            "already found in the library.",
        }
    return results


def tool_get_top_tracks_by_country(
    conn: sqlite3.Connection, args: dict
) -> list[dict] | dict:
    """Find trending tracks in a country via Last.fm, cross-ref with local library."""
    country = args.get("country", "")
    limit = args.get("limit", 50)

    data = _lastfm_get("geo.getTopTracks", country=country, limit=limit)
    if data is None:
        return {
            "matches": 0,
            "hint": "Last.fm API unavailable. Try search_library or "
            "get_top_artists_by_tag instead.",
        }

    tracks = data.get("tracks", {}).get("track", [])
    if isinstance(tracks, dict):
        tracks = [tracks]

    if not tracks:
        return {
            "matches": 0,
            "lastfm_count": 0,
            "hint": f"No trending tracks on Last.fm for '{country}'. Check the "
            "country name spelling (e.g. 'United States' not 'USA').",
        }

    results = []
    for gt in tracks:
        gt_artist = gt.get("artist", {})
        artist_name = (
            gt_artist.get("name", "") if isinstance(gt_artist, dict) else str(gt_artist)
        )
        gt_title = gt.get("name", "")
        results.extend(_find_track_in_library(conn, artist_name, gt_title))

    if not results:
        return {
            "matches": 0,
            "lastfm_count": len(tracks),
            "hint": f"Last.fm returned {len(tracks)} trending tracks for '{country}' "
            "but none are in your library. Try increasing the limit, or use "
            "get_top_artists_by_tag with a regional genre tag.",
        }
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


def _shuffle_spread_artists(tracks: list[dict]) -> list[int]:
    """Shuffle tracks to spread out same-artist tracks for a better mix.

    Uses a greedy approach: repeatedly pick the track whose artist is least
    recently used. This ensures no adjacent tracks from the same artist.
    """
    if not tracks:
        return []

    from collections import Counter

    # Count tracks per artist
    artist_counts = Counter(t["artist"] for t in tracks)

    # Group tracks by artist
    by_artist: dict[str, list[int]] = {}
    for t in tracks:
        artist = t["artist"]
        if artist not in by_artist:
            by_artist[artist] = []
        by_artist[artist].append(t["id"])

    # Shuffle each artist's tracks locally
    import random

    for artist_tracks in by_artist.values():
        random.shuffle(artist_tracks)

    # Greedy selection: always pick from the artist with most remaining tracks
    # who wasn't just played
    result: list[int] = []
    last_artist: str | None = None

    while sum(len(v) for v in by_artist.values()) > 0:
        # Find artists with tracks remaining, excluding last_artist if possible
        available = [
            (artist, len(tracks))
            for artist, tracks in by_artist.items()
            if tracks and artist != last_artist
        ]

        # If no one else available, we have to use last_artist
        if not available:
            available = [
                (artist, len(tracks)) for artist, tracks in by_artist.items() if tracks
            ]

        # Pick artist with most remaining tracks (greedy)
        available.sort(key=lambda x: -x[1])
        chosen_artist = available[0][0]

        # Take one track from that artist
        track_id = by_artist[chosen_artist].pop()
        result.append(track_id)
        last_artist = chosen_artist

    return result


def parse_response(text: str) -> tuple[str, list[int]] | None:
    """Parse 'Playlist: ...\\nTracks: ...' from agent text. Returns (name, ids) or None.

    Deduplicates and caps at MAX_PLAYLIST_TRACKS regardless of model output.
    """
    name = None
    track_ids: list[int] = []
    seen: set[int] = set()
    for line in text.splitlines():
        if line.startswith("Playlist:"):
            name = line[len("Playlist:") :].strip()
        elif line.startswith("Tracks:"):
            raw = line[len("Tracks:") :].strip().strip("[]")
            for tok in raw.split(","):
                tok = tok.strip().strip("[]")
                if tok.isdigit():
                    tid = int(tok)
                    if tid not in seen:
                        seen.add(tid)
                        track_ids.append(tid)
    if name and track_ids:
        return name, track_ids[:MAX_PLAYLIST_TRACKS]
    return None


def _harmonic_mean(values: list[int | float]) -> float:
    """Harmonic mean of values. Returns 0.0 if any value is zero."""
    if not values or any(v == 0 for v in values):
        return 0.0
    return len(values) / sum(1.0 / v for v in values)


EVAL_PROMPT = """\
You are an impartial judge evaluating a playlist generated by an AI agent.

Rate the playlist on three criteria, each scored 0-2:

1. **Concept match** — Does the playlist match the user's request? Consider mood, genre, theme.
   0 = completely off-topic, 1 = partially relevant, 2 = strong match

2. **Instruction following** — Did the agent produce a valid playlist with the right number of tracks?
   0 = no valid playlist, 1 = playlist but wrong count or format issues, 2 = clean valid playlist

3. **Track variety** — Are tracks from diverse artists, or repetitive?
   0 = mostly same artist, 1 = some variety, 2 = wide range of artists

Respond with ONLY this exact format (no other text):
Concept: [[score]]
Instruction: [[score]]
Variety: [[score]]

[User Request]
{prompt}

[Playlist Name]
{playlist_name}

[Tracks]
{track_list}"""


def _evaluate_playlist(
    client: Client,
    model: str,
    prompt: str,
    playlist_name: str,
    tracks: list[dict],
) -> dict[str, int] | None:
    """Run LLM-as-judge evaluation on a generated playlist. Returns scores or None."""
    track_list = "\n".join(
        f"- {t['artist']} - {t['title']}" for t in tracks
    )
    eval_content = EVAL_PROMPT.format(
        prompt=prompt,
        playlist_name=playlist_name,
        track_list=track_list,
    )

    # Prepend /no_think to suppress qwen3's default thinking mode
    eval_content = "/no_think\n" + eval_content

    try:
        response: ChatResponse = client.chat(
            model=model,
            messages=[{"role": "user", "content": eval_content}],
            options={"temperature": 0.0, "num_predict": 128},
            think=False,
        )
    except Exception as e:
        log.error("eval_error", extra={"data": {"error": str(e)}})
        return None

    text = response.message.content or ""
    log.debug("eval_raw_response", extra={"data": {"content": text}})

    scores: dict[str, int] = {}
    for line in text.splitlines():
        for key in ("Concept", "Instruction", "Variety"):
            if line.startswith(f"{key}:"):
                # Try [[N]] first, fall back to bare digit
                m = re.search(r"\[\[(\d)\]\]", line)
                if not m:
                    m = re.search(r":\s*(\d)\s*$", line)
                if m:
                    scores[key.lower()] = int(m.group(1))
    if len(scores) == 3:
        return scores
    log.warning("eval_parse_failure", extra={"data": {"raw": text[:500]}})
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
    seed: int = DEFAULT_SEED,
    repeat_penalty: float = DEFAULT_REPEAT_PENALTY,
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
        {
            "role": "system",
            "content": _build_system_prompt(MIN_PLAYLIST_TRACKS, MAX_PLAYLIST_TRACKS),
        },
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
                "repeat_penalty": repeat_penalty,
                "seed": seed,
                "db_path": str(db_file),
                "track_count": track_count,
            }
        },
    )

    lastfm_status = "configured" if LASTFM_API_KEY else "not configured"
    prompt_source = "env PROMPT override" if PROMPT_OVERRIDE else "default"
    print(f"\n{'=' * 60}")
    seed_str = f" | Seed: {seed}" if seed else ""
    print(
        f"Model: {model} | Max turns: {max_turns} | Think: {think} | Temp: {temperature} | Repeat penalty: {repeat_penalty}{seed_str}"
    )
    print(f"Last.fm: {lastfm_status}")
    print(f"System prompt: {prompt_source}")
    print(f"Prompt: {prompt}")
    print(f"{'=' * 60}\n")

    for turn in range(1, max_turns + 1):
        print(f"--- Turn {turn}/{max_turns} ---")
        log.info("turn_start", extra={"data": {"turn": turn}})

        # Nudge the model to commit on the last turn
        if turn == max_turns:
            messages.append({
                "role": "user",
                "content": "This is your LAST turn. Output the playlist NOW with Playlist: and Tracks: format.",
            })

        kwargs: dict = {
            "model": model,
            "messages": messages,
            "tools": TOOLS,
            "options": {
                "temperature": temperature,
                "top_p": 0.9,
                "num_predict": 2048,
                "repeat_penalty": repeat_penalty,
                **({"seed": seed} if seed else {}),
            },
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
                elif isinstance(result, dict) and "hint" in result:
                    lastfm = result.get("lastfm_count")
                    extra = f" (Last.fm had {lastfm})" if lastfm else ""
                    print(f"    -> 0 matches{extra}: {result['hint']}")
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
                valid_rows = conn.execute(
                    f"SELECT id, title, artist FROM library WHERE id IN ({placeholders})",
                    ids,
                ).fetchall()
                print(
                    f"VALID:  {len(valid_rows)}/{len(ids)} track IDs exist in library"
                )

                # Convert to list of dicts and shuffle to spread out same-artist tracks
                valid_dicts = [dict(v) for v in valid_rows]
                shuffled_ids = _shuffle_spread_artists(valid_dicts)
                print(f"\nSHUFFLED order (artists spread out):")

                # Reorder valid_rows to match shuffled order
                valid_row_dict = {v["id"]: v for v in valid_dicts}
                valid_shuffled = [
                    valid_row_dict[tid] for tid in shuffled_ids if tid in valid_row_dict
                ]

                for t in valid_shuffled:
                    print(f"  [{t['id']}] {t['artist']} - {t['title']}")

                log.info(
                    "parse_success",
                    extra={
                        "data": {
                            "playlist_name": pname,
                            "track_ids": shuffled_ids,
                            "valid_count": len(valid_shuffled),
                        }
                    },
                )

                unique_artists = len({t["artist"] for t in valid_shuffled})
                print(
                    f"\nSummary: {len(valid_shuffled)} tracks, "
                    f"{unique_artists} artists, "
                    f"{turn}/{max_turns} turns"
                )

                # LLM-as-judge evaluation
                print(f"\n--- Evaluation ---")
                eval_scores = _evaluate_playlist(
                    client, model, prompt, pname, valid_shuffled,
                )
                if eval_scores:
                    harmonic = _harmonic_mean(list(eval_scores.values()))
                    print(
                        f"  Concept: {eval_scores['concept']}/2  "
                        f"Instruction: {eval_scores['instruction']}/2  "
                        f"Variety: {eval_scores['variety']}/2  "
                        f"Harmonic mean: {harmonic:.2f}"
                    )
                    log.info(
                        "eval_scores",
                        extra={"data": {**eval_scores, "harmonic_mean": harmonic}},
                    )
                else:
                    print("  Evaluation failed (could not parse judge response)")
                    log.warning("eval_parse_failure")
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
        "--seed",
        type=int,
        default=DEFAULT_SEED,
        help="Random seed for reproducible output (default: 0 = random)",
    )
    parser.add_argument(
        "--repeat-penalty",
        type=float,
        default=DEFAULT_REPEAT_PENALTY,
        help=f"Repetition penalty (default: {DEFAULT_REPEAT_PENALTY})",
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
        seed=args.seed,
        repeat_penalty=args.repeat_penalty,
        log_file=args.log_file,
    )


if __name__ == "__main__":
    main()
