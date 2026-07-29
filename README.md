# Dhandho Restaurant — v2 demo (compiled build)

A live demo of the restaurant app as a **Dhandho OS v2 app**. This repo holds only the
**compiled browser build** — no TypeScript source. The real backend (NestJS + TypeORM
services, entities, event bus, bot) lives privately; here it is bundled to run on-device
against SQLite compiled to WebAssembly, which is exactly the offline mode the phone app uses.

Tap a table, tap dishes, send to the kitchen, bill it. Ingredient stock drops in real time and
the app raises its own restock card. Everything is stored in your own browser — nothing is sent
anywhere, and there is no server.

Built by Buildanta.
