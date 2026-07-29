import fs from "node:fs";

fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/build-proof.txt", "built\n");
