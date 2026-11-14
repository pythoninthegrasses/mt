# TASK-369.4 release-profile matrix

Cold release build of `mt-tauri` per candidate, sccache off: the host column
times the bare `cargo build --release --target <triple> -p mt-tauri`, the
Linux and Windows columns time `tauri-build.sh build` (what their release legs
run). Ratios are relative to each platform's own `lto-fat-cgus1` baseline, i.e.
the committed profile; absolute seconds are only comparable within a column.


## macos

| candidate | mean s | vs baseline | n | binary MiB | Δ | text MiB | staticlib MiB | installer MiB | Δ | target MiB |
|---|---|---|---|---|---|---|---|---|---|---|
| lto-fat-cgus1 | 103.6 | 1.00x | 2 | 10.25 | +0.0% | 9.03 | 308.26 | 5.82 | +0.0% | 1928.75 |
| lto-fat-cgus16 | 96.5 | 0.93x | 2 | 10.48 | +2.3% | 9.25 | 373.26 | 5.82 | -0.0% | 2149.09 |
| lto-fat-cgus4 | 91.2 | 0.88x | 2 | 10.44 | +1.9% | 9.20 | 347.95 | 5.80 | -0.3% | 2066.92 |
| lto-off-cgus1 | 66.0 | 0.64x | 2 | 13.98 | +36.5% | 9.92 | 106.21 | 6.38 | +9.6% | 1245.54 |
| lto-off-cgus16 | 65.2 | 0.63x | 2 | 14.76 | +44.0% | 10.66 | 122.77 | 6.61 | +13.6% | 1303.82 |
| lto-off-cgus4 | 64.3 | 0.62x | 2 | 14.47 | +41.3% | 10.41 | 115.64 | 6.54 | +12.4% | 1279.45 |
| lto-thin-cgus1 | 86.2 | 0.83x | 2 | 13.46 | +31.4% | 9.84 | 308.08 | 6.21 | +6.7% | 1934.46 |
| lto-thin-cgus16 | 48.8 | 0.47x | 2 | 14.49 | +41.4% | 10.69 | 373.43 | 6.49 | +11.6% | 2157.76 |
| lto-thin-cgus4 | 57.7 | 0.56x | 2 | 14.19 | +38.5% | 10.44 | 347.71 | 6.40 | +10.0% | 2073.50 |

## linux

| candidate | mean s | vs baseline | n | binary MiB | Δ | text MiB | staticlib MiB | installer MiB | Δ | target MiB |
|---|---|---|---|---|---|---|---|---|---|---|
| linux-lto-fat-cgus1 | 188.1 | 1.00x | 2 | 13.57 | +0.0% | 9.05 | — | 9.06 | +0.0% | 1628.59 |
| linux-lto-fat-cgus16 | 203.5 | 1.08x | 2 | 14.07 | +3.7% | 9.40 | — | 9.13 | +0.8% | 1761.98 |
| linux-lto-fat-cgus4 | 190.0 | 1.01x | 2 | 13.89 | +2.4% | 9.29 | — | 9.07 | +0.1% | 1699.79 |
| linux-lto-off-cgus1 | 125.2 | 0.67x | 2 | 16.09 | +18.6% | 9.66 | — | 9.31 | +2.8% | 1209.26 |
| linux-lto-off-cgus16 | 93.9 | 0.50x | 2 | 17.58 | +29.5% | 10.36 | — | 9.74 | +7.5% | 1266.91 |
| linux-lto-off-cgus4 | 102.1 | 0.54x | 2 | 17.04 | +25.5% | 10.08 | — | 9.58 | +5.7% | 1240.55 |
| linux-lto-thin-cgus1 | 154.3 | 0.82x | 2 | 15.62 | +15.1% | 9.51 | — | 9.14 | +0.8% | 1632.86 |
| linux-lto-thin-cgus16 | 108.7 | 0.58x | 2 | 17.28 | +27.4% | 10.35 | — | 9.59 | +5.8% | 1769.35 |
| linux-lto-thin-cgus4 | 117.6 | 0.63x | 2 | 16.76 | +23.5% | 10.08 | — | 9.44 | +4.2% | 1706.29 |

## windows

| candidate | mean s | vs baseline | n | binary MiB | Δ | text MiB | staticlib MiB | installer MiB | Δ | target MiB |
|---|---|---|---|---|---|---|---|---|---|---|
| windows-lto-false-cgus1 | 168.7 | — | 2 | — | — | — | — | — | — | — |
| windows-lto-false-cgus16 | 144.2 | — | 2 | — | — | — | — | — | — | — |
| windows-lto-false-cgus4 | 141.8 | — | 2 | — | — | — | — | — | — | — |
| windows-lto-thin-cgus1 | 274.1 | — | 2 | — | — | — | — | — | — | — |
| windows-lto-thin-cgus16 | 179.5 | — | 2 | — | — | — | — | — | — | — |
| windows-lto-thin-cgus4 | 176.5 | — | 2 | — | — | — | — | — | — | — |

_No size data for: windows-lto-false-cgus1, windows-lto-false-cgus16, windows-lto-false-cgus4, windows-lto-thin-cgus1, windows-lto-thin-cgus16, windows-lto-thin-cgus4_
