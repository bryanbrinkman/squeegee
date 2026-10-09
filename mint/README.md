# Squeegee Paint Smear — mint page

A mint site for the ABX edition of *Squeegee Paint Smear*. Built on the scaffold
from `abx mint-page`, restyled for the piece, and set up as a **static site**:
`npm run build` writes plain files to `out/` that run anywhere. There is no
backend. Sale state is read straight from the chain, and visitors mint with
their own browser wallet.

What's on the page: the live artwork (the token's own on-chain page once it
exists, the bundled preview before that), copies minted out of 100, price,
quantity, and one mint button. The count refreshes every 20 seconds.

## Before you deploy the edition

The page works now. With `NEXT_PUBLIC_TOKEN` empty it shows the live preview
and "Not on sale yet", so you can put it up early.

## After you deploy the edition

1. Put the contract address in `NEXT_PUBLIC_TOKEN`, and check the chain id,
   name and RPC match the network you deployed to (see `.env.example`).
2. Make sure the sale is live: `abx minter configure` (price + allocation),
   `set-minter`, `set-primary-payee`, `unpause`. Until then the button reads
   "Not on sale yet".
3. Rebuild and redeploy (below). The `NEXT_PUBLIC_*` values are baked in at
   build time.

Do a full run on Base Sepolia first: deploy there, point the page at it, buy a
copy through the page yourself.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:3000
```

## Host on Vercel

```bash
npm i -g vercel
vercel           # first run links/creates the project
vercel --prod
```

Add the same `NEXT_PUBLIC_*` variables in the Vercel dashboard (Project →
Settings → Environment Variables) and redeploy.

## Host on bryanbrinkman.com

```bash
npm install
npm run build    # writes out/
```

Upload the **contents** of `out/` to your server.

- At a subfolder such as `bryanbrinkman.com/paint-smear`: set
  `NEXT_PUBLIC_BASE_PATH=/paint-smear` in `.env.local` *before* building, then
  upload `out/` into that folder.
- On its own subdomain or domain root: leave `NEXT_PUBLIC_BASE_PATH` empty.

It needs HTTPS (wallets refuse plain http).

## Editing

- Words: `lib/content.ts` (title, artist, description, details).
- Look: `app/globals.css`. The page colour is the artwork's own wall colour,
  so the piece sits in it without a visible edge.
- The fallback preview (`public/preview/`) uses the same script and p5
  version as the on-chain edition. If you change the artwork, copy the new
  `paint-smear.abx.js` in there too.

## Wallets

Any injected browser wallet works (MetaMask, Coinbase Wallet, Rabby…). On a
phone without one, the page offers "Open in MetaMask" and "Open in Coinbase
Wallet", which reopen it inside that app. For WalletConnect-style QR pairing,
swap in RainbowKit + wagmi (needs a WalletConnect project id).

The mint call commits to the price shown: if the sale is re-priced mid-click
the minter reverts and nothing is charged; the page then shows the new price.

## Credits

Font: Archivo (SIL Open Font License, `app/fonts/OFL.txt`).
