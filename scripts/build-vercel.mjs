import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/static", { recursive: true });
await cp("static/index.html", "dist/index.html");
await cp("static/styles.css", "dist/static/styles.css");
await cp("static/app.js", "dist/static/app.js");
await cp("static/favicon.svg", "dist/static/favicon.svg");
