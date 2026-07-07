import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

fs.rmSync("dist/npm", { recursive: true, force: true });
fs.mkdirSync("dist/npm", { recursive: true });

const common = {
    entryPoints: [
        "src/index.ts",
        "src/domain.ts",
        "src/drag.ts",
        "src/drag-runtime.ts",
        "src/markdown.ts",
    ],
    bundle: true,
    platform: "neutral",
    target: "es2018",
    sourcemap: false,
    logLevel: "info",
    outdir: "dist/npm",
    entryNames: "[name]",
};

await esbuild.build({
    ...common,
    format: "esm",
    outExtension: { ".js": ".mjs" },
});

await esbuild.build({
    ...common,
    format: "cjs",
    outExtension: { ".js": ".cjs" },
});

const tscBin = process.platform === "win32"
    ? ".\\node_modules\\.bin\\tsc.cmd"
    : "node_modules/.bin/tsc";
if (process.platform === "win32") {
    execFileSync("cmd", ["/c", tscBin, "-p", "tsconfig.package.json"], { stdio: "inherit" });
} else {
    execFileSync(tscBin, ["-p", "tsconfig.package.json"], { stdio: "inherit" });
}
console.log("✓ npm core package built");
