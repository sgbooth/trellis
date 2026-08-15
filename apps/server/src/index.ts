import { createApp } from "./app.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

createApp().listen(PORT, () => console.log(`[server] listening on :${PORT}`));
