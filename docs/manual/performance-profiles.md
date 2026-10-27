# Performance profiles

A profile sets sensible limits for the machine that hosts the game, so a Raspberry Pi Zero W and a mini PC
can both run it without hand tuning.

## The three profiles

| | `LOW_POWER` | `NORMAL` (default) | `HIGH` |
|---|---|---|---|
| Simulation steps per second (`TICK_RATE`) | 30 | 60 | 60 |
| Updates sent per second (`NET_RATE`) | 15 | 20 | 30 |
| Players per room (`MAX_PLAYERS`) | 8 | 8 | 16 |
| Rooms at once (`MAX_ROOMS`) | 2 | 4 | 8 |
| Spectators per room (`MAX_SPECTATORS`) | 4 | 8 | 16 |

These are starting points. Measure on your own hardware (below) and raise or lower them.

## Choosing one

| Machine | Start with |
|---|---|
| Raspberry Pi Zero W or similar single-core board | `LOW_POWER` |
| Raspberry Pi 3 / 4, Orange Pi | `NORMAL` |
| Mini PC, laptop, a regular server | `HIGH` |

## Selecting and overriding

Choose the profile with `PROFILE` (or `performance.profile` in the config file). Any single value can then be
overridden:

```bash
PROFILE=LOW_POWER npm start
PROFILE=HIGH MAX_ROOMS=8 TICK_RATE=60 NET_RATE=30 npm start
```

```yaml
performance:
  profile: HIGH
  maxRooms: 6
```

A file value beats an environment variable, which beats the profile. The effective network rate never exceeds
the tick rate. See [Configuration](configuration.md) for the full list.

## Watching the load

Open `/stats` (or the **Health** tab in the admin panel). The numbers to watch:

| Field | Meaning | Healthy |
|---|---|---|
| tick step (avg / max) | time spent computing one step | well below the step length (16 ms at 60 steps/s) |
| tick lag (avg / max) | how late a step started | close to zero |
| overruns | steps that took longer than their budget | stays near 0 |
| `cpuPercent`, `rssMB` | server CPU and memory | CPU not pinned, memory stable |

Sustained overruns mean the box cannot hold the tick rate: lower `TICK_RATE`, `MAX_ROOMS` or `MAX_PLAYERS`, or
move to a faster profile's hardware.

## Measuring with bots

The load test plays real matches with simulated players against a running server. Run it from another machine on
the same network for realistic numbers:

```bash
npm run loadtest -- --url ws://<server-address>:8080/ws --sweep --duration 30
npm run loadtest -- --url ws://<server-address>:8080/ws --players 8 --rooms 1,2,3,4 --duration 30
npm run loadtest -- --help
```

The first command tries 1, 2, 4, 8, 12 and 16 players; the second looks for the room limit. A built image has
the same tool as `node dist/loadtest.js`. The project's `BENCHMARKS.md` records reference runs and explains each
column. At the time of writing the numbers there come from a development PC, not from a Pi.
