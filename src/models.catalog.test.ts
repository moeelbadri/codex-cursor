import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelsCatalog } from "./models.ts";

const tmpDir = join(import.meta.dir, ".tmp-models-catalog-test");

describe("ModelsCatalog", () => {
  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("loads slugs from a cache file on disk", async () => {
    await mkdir(tmpDir, { recursive: true });
    const cachePath = join(tmpDir, "models_cache.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        models: [
          { slug: "gpt-5.6-terra", visibility: "list", supported_in_api: true },
          { slug: "gpt-5.6-luna", visibility: "list", supported_in_api: true },
          { slug: "gpt-reserve", visibility: "hide", supported_in_api: true },
        ],
      }),
    );
    const listed = await new ModelsCatalog(cachePath).listModels();
    expect(listed.source).toBe("file");
    expect(listed.ids.sort()).toEqual(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-reserve"]);
  });
});
