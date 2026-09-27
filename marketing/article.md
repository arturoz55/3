# Title for X

**Forkline: give open source its own market**

(Shorter alternative: **Stars don't pay maintainers. Forkline wants to change that.**)

---

# Forkline: give open source its own market

Open source runs the internet, and most of the people who build it are paid in stars. A popular repository can pick up thousands of them and still have no way to turn that attention into support. Donation buttons get ignored. Sponsorship programs favor the few projects that are already famous.

Forkline starts from a simple idea: if people already follow a project, let them back it directly. Every market on Forkline is tied to a real, public GitHub repository, and every number on the page comes from that repository.

## How it works

**1. Paste a repository.** Any public GitHub project works, as a full URL or as `owner/repo`. Forkline reads its stars, forks, commits, contributors, language and last push straight from GitHub. Nothing is typed in by hand, so nobody can inflate the stats.

**2. Prove you maintain it.** Forkline gives you a one-time code. You commit it to a file called `.forkline` on the repository's default branch, and Forkline reads that file back from GitHub. Only someone with write access to the repository can do that, which is why a "verified" label on Forkline means the launch came from the people who actually maintain the code. Repositories can still be launched without the check, but they carry an "unverified" label everywhere they appear.

**3. Launch the market.** Pick a name and a ticker. The market opens on a constant-product bonding curve: the price rises as people buy and falls as they sell. Every trade pays a 1% fee, split evenly between the market's creator and the Forkline treasury. When the curve sells out, the market graduates.

**4. Follow the project.** Watch the price next to the repository's own activity, star markets to keep them on your watchlist, and talk with other backers in each market's discussion.

## Why Zcash

Forkline uses Zcash in two places.

**Tips for maintainers in ZEC.** A maintainer can add one more line to the same `.forkline` file: `zcash=` followed by their Zcash address. The market page then shows a QR code and a standard payment link (ZIP-321) that Zcash wallets open with the amount already filled in. With a shielded address, the amount and the memo stay private between the backer and the maintainer.

The address has to live inside the repository, and that matters. Anyone can launch a market for a popular project, but only its maintainers can commit to it. So tips always reach the people who write the code, and never someone who launched their project under a lookalike name. Forkline also checks every address's checksum before showing it, so a typo can't send money into the void.

**Shielded trades.** Borrowing the idea behind Zcash's shielded transactions, a trader can tick one box to keep their trade out of the public record. The activity feed shows that a trade happened, but not who made it or how much it was. Holder lists show a shielded holder instead of an address.

## $FORK

$FORK is the Forkline community token.

- Contract address: `[CONTRACT ADDRESS]`
- Network: `[NETWORK]`
- Official account: [@Forklinetech](https://x.com/Forklinetech). Only trust addresses posted there.

## Try it

The Forkline demo is open now. You get a play wallet with 10 ETH, and the repository data and ownership check are real, so you can launch your own project and see exactly how it works. In this version the markets run on a simulated curve in your browser, and no real funds move.

[SITE LINK]

*Crypto assets are volatile and you can lose everything you put in. Nothing here is financial advice.*
