# Forkline

Launch open source: turn a public GitHub repository into a market.

Forkline is a static single-page app (plain HTML, CSS and JavaScript, no build step).

## Features

- **Live GitHub data**: stars, forks, commits, contributors, language and last push, read from the public GitHub API.
- **Real ownership check**: Forkline gives you a one-time code. Commit it in a `.forkline` file on the default branch, and Forkline reads that file from GitHub to confirm you maintain the repository.
- **Bonding-curve markets (simulated)**: each market uses a constant-product curve (`x · y = k`) with virtual reserves, a 1% fee split between the creator and the treasury, and graduation once 800M tokens are sold.
- **Sky**: a procedural sky with drifting clouds, drawn on canvas with fractal noise (no image assets).
- **Demo wallet**: 10 play ETH. All state is kept in your browser's `localStorage`. No real funds move.
- Explore (trending / recent / most active, search with the `/` shortcut, verified and watchlist filters), activity feed with filters, ticker, treasury, profile, and a mobile dock.
- Watchlist (☆ on any market), price-impact warnings before a trade, chart hover tooltips, per-market discussion, profit and loss per holding, and a play-ETH faucet (5 ETH per hour).

## Run locally

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

Unauthenticated GitHub API calls are limited to 60 per hour per IP address. Each repository lookup uses 3 of them.

## License

[MIT](LICENSE)
