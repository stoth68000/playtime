# PlayTime

PlayTime is a local MPEG-TS playout control application. It scans transport-stream libraries, saves playout collections as JSON, and supervises `tstools_bitrate_smoother` instances through a REST API and dark broadcast-style web UI.

## Quick Start

```sh
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The API runs on:

```text
http://127.0.0.1:4500
```

Edit `data/settings.json` to point `libraryPaths` at your MPEG-TS library and adjust `smootherArgs` to match your `tstools_bitrate_smoother` command-line contract.
