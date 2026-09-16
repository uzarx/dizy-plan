const { chromium } = require("playwright");
const fs = require("fs");
const assert = require("assert");
fs.mkdirSync("tests/artifacts", { recursive: true });
(async () => {
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
    acceptDownloads: true,
  });
  let errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ready = () =>
    page.waitForFunction(() => project?.entities.length > 0 && !loading);
  await page.goto(process.env.DIZY_URL || "http://127.0.0.1:8766");
  await ready();
  assert(await page.evaluate(() => project.entities.length > 10));
  console.log("PASS synthetic demo");
  const target = await page.evaluate(() => {
    for (const e of project.entities) {
      if (e.type !== "INSERT" || !visible(e)) continue;
      for (const s of e.shapes) {
        if (s.kind !== "path") continue;
        for (let i = 1; i < s.points.length; i++) {
          const a = screen(s.points[i - 1]),
            b = screen(s.points[i]),
            p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (
            p[0] > 100 &&
            p[1] > 90 &&
            p[0] < width - 50 &&
            p[1] < height - 70 &&
            hitTest(p) === e.id
          )
            return { id: e.id, p };
        }
      }
    }
  });
  assert(target);
  const box = await page.locator("#canvas").boundingBox();
  await page.mouse.click(box.x + target.p[0], box.y + target.p[1]);
  assert.equal(await page.evaluate(() => selected), target.id);
  await page.mouse.move(box.x + target.p[0], box.y + target.p[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + target.p[0] + 35, box.y + target.p[1] + 20, {
    steps: 5,
  });
  await page.mouse.up();
  assert(await page.evaluate(() => Object.keys(project.edits).length > 0));
  console.log("PASS select and drag CAD block");
  await page.locator("#dx").fill("300");
  await page.locator("#dy").fill("-100");
  await page.locator("#rotation").fill("90");
  await page.locator("#apply-transform").click();
  assert.deepEqual(
    await page.evaluate(() => [
      getEdit(entity()).dx,
      getEdit(entity()).dy,
      getEdit(entity()).rotation,
    ]),
    [300, -100, 90],
  );
  await page.locator("#undo-btn").click();
  await page.locator("#redo-btn").click();
  assert.equal(
    await page.evaluate((id) => project.edits[id].dx, target.id),
    300,
  );
  console.log("PASS precise move, rotation, undo, redo");
  // Draw a line with two pointer clicks.
  await page.locator("[data-tool=line]").click();
  await page.mouse.click(box.x + 120, box.y + 100);
  await page.mouse.click(box.x + 200, box.y + 145);
  assert.equal(await page.evaluate(() => project.additions.length), 1);
  await page.locator("[data-tool=rect]").click();
  await page.mouse.click(box.x + 125, box.y + 175);
  await page.mouse.click(box.x + 205, box.y + 215);
  assert.equal(await page.evaluate(() => project.additions.length), 2);
  console.log("PASS line and rectangle drawing");
  await page.locator("[data-tool=measure]").click();
  await page.mouse.click(box.x + 120, box.y + 250);
  await page.mouse.click(box.x + 210, box.y + 250);
  assert(await page.evaluate(() => draft.finished));
  console.log("PASS measurement");
  await page.locator("[data-tool=note]").click();
  await page.mouse.click(box.x + 420, box.y + 405);
  await page.locator("#note-text").fill("Divanni 300 mm o‘ngga suring. <test>");
  await page.locator("#note-form button[type=submit]").click();
  assert.equal(await page.locator(".note-card").count(), 1);
  await page
    .locator("#brief")
    .fill("Mehmonxona joylashuvini yangi izoh bo‘yicha yangilang.");
  await page.locator("#brief").blur();
  console.log("PASS pinned note and task brief");
  await page.waitForTimeout(700);
  await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => project.notes.length), 1);
  assert.equal(
    await page.evaluate(
      () => project.edits[Object.keys(project.edits)[0]].rotation,
    ),
    90,
  );
  console.log("PASS IndexedDB restore after reload");
  const save = page.waitForEvent("download");
  await page.locator("#save-btn").click();
  const json = await save;
  await json.saveAs("tests/artifacts/edited.dizy.json");
  assert.equal(
    JSON.parse(fs.readFileSync("tests/artifacts/edited.dizy.json")).notes
      .length,
    1,
  );
  await page
    .locator("#file-input")
    .setInputFiles("tests/artifacts/edited.dizy.json");
  await ready();
  assert.equal(await page.evaluate(() => project.additions.length), 2);
  console.log("PASS saved project reimport");
  await page.locator("#export-btn").click();
  const dxfDl = page.waitForEvent("download");
  await page.locator("[data-format=dxf]").click();
  await (await dxfDl).saveAs("tests/artifacts/edited.dxf");
  await ready();
  console.log("PASS DXF export");
  const dwgEnabled = await page.locator("[data-format=dwg]").isEnabled();
  if (dwgEnabled) {
    await page.locator("#export-btn").click();
    const dwgDl = page.waitForEvent("download", { timeout: 100000 });
    await page.locator("[data-format=dwg]").click();
    await (await dwgDl).saveAs("tests/artifacts/edited.dwg");
    await ready();
    assert.equal(
      fs.readFileSync("tests/artifacts/edited.dwg").subarray(0, 6).toString(),
      "AC1032",
    );
    console.log("PASS real AC1032 DWG export");
  }
  const zipDl = page.waitForEvent("download");
  await page.locator("#handoff-btn").click();
  await (await zipDl).saveAs("tests/artifacts/handoff.zip");
  await ready();
  console.log("PASS task ZIP export");
  await page.locator("[data-tab=notes]").click();
  await page.screenshot({ path: "tests/artifacts/editor-with-notes.png" });
  if (dwgEnabled) {
    await page
      .locator("#file-input")
      .setInputFiles("tests/artifacts/edited.dwg");
    await page.waitForFunction(
      () => !loading && project.name === "edited.dwg",
      null,
      { timeout: 100000 },
    );
    assert(await page.evaluate(() => project.entities.length > 10));
    console.log("PASS exported DWG import");
  }
  assert.deepEqual(errors, []);
  console.log("PASS no browser errors");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
