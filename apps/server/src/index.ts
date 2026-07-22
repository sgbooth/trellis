import { createApp } from "./app.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

const app = createApp();
app.listen(PORT).then(() => console.log(`[server] listening on :${PORT}`));
