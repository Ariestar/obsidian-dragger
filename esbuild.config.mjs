import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";

const prod = process.argv[2] === "production";
const pluginDir = "V:/dragger/.obsidian/plugins/dragger";

// 复制 styles.css 到插件目录
function copyStyles() {
    fs.copyFileSync("styles.css", `${pluginDir}/styles.css`);
    console.log("✓ styles.css copied to plugin directory");
}

function copyManifest() {
    fs.copyFileSync("manifest.json", `${pluginDir}/manifest.json`);
    console.log("✓ manifest.json copied to plugin directory");
}

const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
        "@codemirror/autocomplete",
        "@codemirror/collab",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/lint",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/common",
        "@lezer/highlight",
        "@lezer/lr",
        ...builtins,
    ],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: `${pluginDir}/main.js`,
});

if (prod) {
    await context.rebuild();
    copyStyles();
    copyManifest();
    process.exit(0);
} else {
    copyStyles();
    copyManifest();
    await context.watch();
}
