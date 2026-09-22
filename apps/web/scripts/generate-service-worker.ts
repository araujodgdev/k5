import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Changing the worker on every build makes updates discoverable even when only
// application code changed. The previous worker stays active until accepted.
const template = await readFile(new URL("./service-worker.js", import.meta.url), "utf8");
const pushClient = await readFile(new URL("../src/lib/notifications/push-client.js", import.meta.url), "utf8");
await writeFile(new URL("../public/sw.js", import.meta.url),
  `${pushClient.replace(/^export /gm, "")}\n${template.replace("__K5_BUILD__", randomUUID())}`);
