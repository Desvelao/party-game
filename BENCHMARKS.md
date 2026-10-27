# Benchmarks

Run on the device that hosts the server (bots on another machine on the same LAN for realistic numbers):

```bash
PROFILE=HIGH MAX_ROOMS=16 npm start                       # on the board
npm run loadtest -- --url ws://<board-ip>:8080/ws --sweep --duration 30      # players 1..16
npm run loadtest -- --url ws://<board-ip>:8080/ws --players 8 --rooms 1,2,3,4 --duration 30  # room limit
```

Columns come straight from `GET /stats` (server) and bot RTT measurements. "Lag" is how late a
simulation tick started vs. its schedule; sustained lag or overruns mean the box can't hold the tick rate.

## Profile store (json driver)

The json store keeps every profile in memory and rewrites the whole file, asynchronously and one write at a time, at most
every 500 ms while results are recorded. It logs `profile store flush took N ms for M profiles` when a flush (serialising
plus writing) takes more than 250 ms: on a Pi Zero W with many thousands of profiles, switch to the sqlite store.
Not measured on real hardware yet (see the Pi rows below).

## Reference (dev machine, Docker, NORMAL profile, 60 Hz / 20 Hz)

| rooms | players | CPU % | RSS MB | tick avg/max ms | lag avg/max ms | overruns | msgs/s out | KB/s out | RTT avg/p95/max ms | drops | disconnects |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 8 | 6.9 | 66.5 | 0.21/2.50 | 0.62/2.1 | 0 | 198 | 115.3 | 0.4/0.7/0.8 | 0 | 0 |

## Per-family sweep (dev machine, native, NORMAL profile, 60 Hz / 20 Hz) — NOT Pi numbers

Measured on this dev machine, not on any Pi: AMD Ryzen 5 2600 Six-Core Processor, Node v22.22.3, server and bots on the
same host over loopback (`npm run build:games` first, since the server only plays packs; then `PORT=18123 npx tsx src/core/server/main.ts`, then
`npx tsx src/core/tools/loadtest.ts --url ws://127.0.0.1:18123/ws --game <id> --sweep --duration 10`).
The sweep asks for 1,2,4,8,12,16 players, but NORMAL caps a room at 8, so the 12 and 16 runs got `ROOM_FULL` and
are omitted (rerun with `PROFILE=HIGH` for those). 10 s per point, 1 room, no `--variant`, so each run uses the game's default (no variant forced).
Zero overruns, drops and disconnects in every row shown.

### Ballistix family (`--game ballistix`)

| rooms | players | CPU % | RSS MB | tick avg/max ms | lag avg/max ms | overruns | msgs/s out | KB/s out | RTT avg/p95/max ms | drops | disconnects |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 1.4 | 96.3 | 0.10/1.76 | 0.57/1.7 | 0 | 21 | 10.6 | 0.3/0.5/0.5 | 0 | 0 |
| 1 | 2 | 2.4 | 96.4 | 0.11/0.55 | 0.57/1.2 | 0 | 43 | 24.2 | 0.3/0.4/0.4 | 0 | 0 |
| 1 | 4 | 2.3 | 96.4 | 0.14/0.78 | 0.55/1.5 | 0 | 87 | 65.7 | 0.2/0.4/0.4 | 0 | 0 |
| 1 | 8 | 3.3 | 96.4 | 0.15/1.24 | 0.56/1.5 | 0 | 174 | 181.0 | 0.2/0.3/0.3 | 0 | 0 |

### Frost Shove family (`--game frost-shove`)

| rooms | players | CPU % | RSS MB | tick avg/max ms | lag avg/max ms | overruns | msgs/s out | KB/s out | RTT avg/p95/max ms | drops | disconnects |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 1.3 | 96.5 | 0.08/1.67 | 0.57/1.7 | 0 | 22 | 7.3 | 0.4/0.4/0.4 | 0 | 0 |
| 1 | 2 | 1.4 | 96.5 | 0.07/0.73 | 0.56/1.7 | 0 | 47 | 19.6 | 0.3/0.5/0.5 | 0 | 0 |
| 1 | 4 | 2.2 | 96.7 | 0.11/1.31 | 0.55/1.8 | 0 | 96 | 58.1 | 0.3/0.5/0.5 | 0 | 0 |
| 1 | 8 | 3.9 | 97.0 | 0.18/1.58 | 0.56/1.4 | 0 | 202 | 193.7 | 0.3/0.7/0.9 | 0 | 0 |

### Spring Showdown family (`--game spring-showdown`)

| rooms | players | CPU % | RSS MB | tick avg/max ms | lag avg/max ms | overruns | msgs/s out | KB/s out | RTT avg/p95/max ms | drops | disconnects |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 1.6 | 97.2 | 0.09/1.11 | 0.58/1.5 | 0 | 21 | 15.8 | 0.4/0.6/0.6 | 0 | 0 |
| 1 | 2 | 1.7 | 97.5 | 0.08/0.47 | 0.57/1.3 | 0 | 43 | 35.4 | 0.3/0.4/0.4 | 0 | 0 |
| 1 | 4 | 2.1 | 97.5 | 0.11/0.69 | 0.56/1.8 | 0 | 86 | 92.9 | 0.3/0.5/0.6 | 0 | 0 |
| 1 | 8 | 3.6 | 98.0 | 0.17/0.91 | 0.55/1.5 | 0 | 172 | 264.2 | 0.3/0.9/1.4 | 0 | 0 |

### Box Bonanza family (`--game box-bonanza`)

| rooms | players | CPU % | RSS MB | tick avg/max ms | lag avg/max ms | overruns | msgs/s out | KB/s out | RTT avg/p95/max ms | drops | disconnects |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 1.8 | 98.5 | 0.11/2.33 | 0.58/1.7 | 0 | 22 | 17.1 | 0.3/0.4/0.4 | 0 | 0 |
| 1 | 2 | 2.5 | 98.3 | 0.12/0.55 | 0.58/1.4 | 0 | 45 | 40.6 | 0.3/0.5/0.5 | 0 | 0 |
| 1 | 4 | 3.3 | 98.6 | 0.15/0.68 | 0.57/1.5 | 0 | 93 | 102.1 | 0.3/0.5/0.5 | 0 | 0 |
| 1 | 8 | 3.9 | 99.3 | 0.20/2.63 | 0.52/1.5 | 0 | 204 | 278.2 | 0.2/0.4/1.3 | 0 | 0 |

## Raspberry Pi Zero W (512 MB) — TODO
## Raspberry Pi 3 B+ (1 GB) — TODO
## Orange Pi Zero 3 (1 GB) — TODO
## Raspberry Pi 4 (1 GB) — TODO

For each: profile used, tick/net rate, results table, practical player limit, rooms limit, notes.
Update `PROFILES` in `src/core/server/config.ts` from the measured numbers.
