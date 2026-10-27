# Security policy

This project is pre-1.0. Only the latest release receives fixes.

## Reporting a vulnerability
Please do not open a public issue. Use GitHub's private vulnerability reporting (Security tab, **Report a vulnerability**), or email iamdesvelao@gmail.com. Include the version, how to reproduce it and the impact. You can expect a first reply within a week.

## Notes for operators
- Set `ADMIN_TOKEN` (and `BOTS_TOKEN` if you run the bot service) to long random values. The `dev-stats` and `dev-bots` defaults in `docker-compose.yml` are for local development only; `docker-compose.prod.yml` has no defaults.
- A profile code works like a password: anyone who has it can use that profile. Do not publish the `data/` directory.
- Put the server behind TLS when it is reachable from the internet (see `docs/manual/deployment.md`).
