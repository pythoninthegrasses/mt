# mt

`mt` is a simple desktop music player designed for large music collections.

![mt](static/cover.png)

## Minimum Requirements

* OS
  * macOS Sequoia (15.7+)
  * Linux
    * Debian
    * Ubuntu
  * Windows 11 (21H2+)

## Features

* **Built for large libraries**: virtual scrolling, content-aware reloading, and LRU-cached artwork
* **Cross-platform**: macOS, Linux, and Windows with native media key and OS Now Playing support
* **Themeable**: light, dark, and system themes with customizable columns
* **Artists and Albums views**: split-pane artist browser and album grid with detail view
* **Playlists and queue management**: drag-and-drop reordering, play next, play history navigation
* **Metadata editing**: read and write tags directly on audio files, including batch editing
* **Watched folders**: multi-directory monitoring with real-time filesystem events, duplicate detection, and move tracking
* **Keyboard-driven**: shortcuts for playback, search, navigation, and type-to-jump by artist
* **Last.fm integration**: scrobbling, now playing, loved track sync, queued retry on failure, and bidirectional loved tracks sync

## Downloads

Download the latest release from [GitHub Releases](https://github.com/pythoninthegrass/mt/releases).

## Development

See [Builds](docs/builds.md) for build configuration, performance tuning, and signing.

### Requirements

* [node 24.2.0](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
* [rust 1.92.0](https://doc.rust-lang.org/book/ch01-01-installation.html)
  * Be sure to install `rustup`!
* [task](https://taskfile.dev/docs/installation)

### Setup

```bash
# install deps
task npm:install

# run dev server
task tauri:dev
```

## Credit

* MusicBee for years of rock-solid playback and inspiration to build a subset of its features for other operating systems
* Logo
  * [Music - Sentya Irma](https://thenounproject.com/icon/music-6387002/)
  * [mango tree - Aisyah](https://thenounproject.com/icon/mango-tree-6730625/)

## TODO

See [TODO.md](TODO.md) for a list of features and improvements.
