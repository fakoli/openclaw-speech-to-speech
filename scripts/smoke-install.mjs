import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "openclaw-speech-to-speech-"));
const packDirectory = join(temporaryRoot, "pack");
const isolatedHome = join(temporaryRoot, "home");
const npmCli = process.env.npm_execpath;
const openclawCli = join(root, "node_modules", "openclaw", "openclaw.mjs");

assert(npmCli, "run the package smoke test through `npm run test:package`");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

mkdirSync(packDirectory, { recursive: true });
mkdirSync(isolatedHome, { recursive: true });

try {
  const packOutput = run(process.execPath, [
    npmCli,
    "pack",
    "--silent",
    "--pack-destination",
    packDirectory,
    "--json",
  ]);
  const packageInfo = JSON.parse(packOutput).at(0);
  assert(packageInfo?.filename, "npm pack did not return an artifact filename");

  const tarball = join(packDirectory, packageInfo.filename);
  const env = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    OPENCLAW_HOME: join(isolatedHome, ".openclaw"),
  };

  run(
    process.execPath,
    [openclawCli, "plugins", "install", `npm-pack:${tarball}`, "--force"],
    { env },
  );
  const inspection = JSON.parse(
    run(
      process.execPath,
      [openclawCli, "plugins", "inspect", "speech-to-speech", "--runtime", "--json"],
      { env },
    ),
  );

  assert.equal(inspection.plugin?.status, "loaded");
  assert.deepEqual(inspection.diagnostics, []);
  assert.deepEqual(
    inspection.plugin?.realtimeVoiceProviderIds,
    ["anvil-serving", "openai-cascade"],
  );
  assert.match(inspection.plugin?.description ?? "", /Anvil Serving/u);

  const installedRoot = inspection.plugin?.rootDir;
  assert(installedRoot, "OpenClaw inspection did not return the installed package root");
  for (const packagedFile of [
    "SECURITY.md",
    "CONTRIBUTING.md",
    join("docs", "CONFIGURATION.md"),
    join("docs", "TROUBLESHOOTING.md"),
    join("docs", "VOICE_STACKS.md"),
  ]) {
    assert(
      existsSync(join(installedRoot, packagedFile)),
      `installed package is missing ${packagedFile}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      status: inspection.plugin.status,
      providers: inspection.plugin.realtimeVoiceProviderIds,
      diagnostics: inspection.diagnostics.length,
      artifact: packageInfo.filename,
    })}\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
