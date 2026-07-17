import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public page contains no promotional banners", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.doesNotMatch(
    html,
    /code\.revia\.top|buycodekey\.com|promo-(?:links|banner)|rel=["']sponsored\b/i,
  );
});
