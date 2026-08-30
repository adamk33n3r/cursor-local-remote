# Host list then Host flow (throwaway)

Question: how should Login → Host list → Host feel on a Client?

Run from this branch:

```
npm run prototype:host-list-flow
```

Then open `/prototype/host-list-flow?variant=A` (also `B`, `C`). Arrow keys and the bottom bar switch variants.

- **A (Stacked pages)**: full-screen Login, then a linear Host list, then Host with a top bar.
- **B (Persistent Host rail)**: Login beside a locked list; after Login the Hosts stay in a rail while the Host fills the rest.
- **C (Cards and sheets)**: splash Login sheet, poster cards for online Hosts, Forget as a confirm sheet, Host with floating Hosts chip.

In-memory only. No tunnel. Lab buttons above the variants flip online/offline and simulate opening a sticky Host URL.
