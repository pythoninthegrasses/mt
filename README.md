# mt

`mt` is a simple desktop music player designed for large music collections.

![mt](static/cover.png)

## Minimum Requirements

* macOS/Linux
* [node 24.2.0](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
* [rust 1.92.0](https://doc.rust-lang.org/book/ch01-01-installation.html)
  * Be sure to install `rustup`!
* [task](https://taskfile.dev/docs/installation)

## Setup

```bash
# install deps
task npm:install

# run dev server
task tauri:dev
```

## Usage

> [!WARNING]
> This app is currently pre-alpha and is not yet a good daily driver for playing music you don't mind getting sucked into a black hole.
> 
> THERE BE DRAGONS
> 
> With that said, with the 1.0.0 release candidate, a proper signed build will be added and this message will be removed.
>
> For meow, you'll have to build the app per the [dev](#run-the-app) section 👌

## Development

Same as [Setup](#setup) while in alpha.

See [Builds](docs/builds.md) for build configuration, performance tuning, and signing.

#### Features

* Multi-directory watching
* Content-aware reloading (only when content changes)
* Rich console output with progress indicators
* Cross-platform support (Windows, macOS, Linux)

<!-- TODO: install -->

## TODO

See [TODO.md](TODO.md) for a list of features and improvements.
