import { expect, test, type Locator } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await connectBrowserDemo(page);
});

test("navigates every core workspace and preserves a responsive shell", async ({ page }) => {
  const journeys = [
    ["Rig Editor", /Editing rig/i], ["Rigs & Setlists", "Rigs & Setlists"], ["StageHand", "StageHand"],
    ["TonePilot", "TonePilot"], ["Performance Tools", "Performance Tools"], ["Library & Backup", "Library & Backup"],
    ["Settings", "Settings"], ["Diagnostics", "Diagnostics"],
  ] as const;
  for (const [navigation, heading] of journeys) {
    await page.getByRole("button", { name: new RegExp(`^${navigation}`) }).click();
    if (typeof heading === "string") await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    else await expect(page.getByText(heading).first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Collapse" }).click();
  await expect(page.locator(".app")).toHaveClass(/app--collapsed/);
});

test("loads the Global EQ graph styles before Rig Editor has been visited", async ({ page }) => {
  // Performance Tools shares EqGraph with Rig Editor. Its visual contract must
  // travel with that component instead of depending on an earlier route visit.
  await page.getByRole("button", { name: /^Performance Tools/ }).click();

  const graph = page.locator(".global-eq-stage .graphic-eq");
  await expect(graph).toBeVisible();
  await expect(graph).toHaveCSS("isolation", "isolate");
  await expect(graph).toHaveCSS("overflow", "hidden");
  await expect(graph.locator(".eq-graph-status")).toHaveCSS("position", "absolute");
  await expect(graph.locator(".eq-axis")).toHaveCSS("display", "flex");
});

test("drags effects in the Rig Editor and both Test Rig chain surfaces", async ({ page }) => {
  const pointerDrag = async (source: Locator, target: Locator) => {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const from = await source.boundingBox(); const to = await target.boundingBox();
    expect(from).not.toBeNull(); expect(to).not.toBeNull();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
    await page.mouse.up();
  };

  await page.getByRole("button", { name: /^Rig Editor/ }).click();
  await page.evaluate(async () => {
    // @ts-expect-error Vite exposes source modules in the E2E development build.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Test-only instrumentation.
    window.__rigChainMoves = [];
    useAppStore.setState({ moveBlock: async (from: number, to: number) => {
      // @ts-expect-error Test-only instrumentation.
      window.__rigChainMoves.push([from, to]);
    } });
  });
  await pointerDrag(page.locator('[data-chain-slot="4"] .block-node'), page.locator('[data-chain-slot="10"]').first());
  await expect.poll(() => page.evaluate(() => {
    // @ts-expect-error Test-only instrumentation.
    return window.__rigChainMoves;
  })).toEqual([[4, 10]]);

  await page.getByRole("button", { name: "TonePilot", exact: true }).click();
  await page.getByRole("tab", { name: /Test Rig Studio/i }).click();
  await page.evaluate(async () => {
    // @ts-expect-error Vite exposes source modules in the E2E development build.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Test-only instrumentation.
    window.__testRigChainMoves = [];
    useAppStore.setState({ selectedTestRigId: "lead", moveTestRigBlock: (blockId: string, slot: number) => {
      // @ts-expect-error Test-only instrumentation.
      window.__testRigChainMoves.push([blockId, slot]);
    } });
  });

  const compactChain = page.locator(".tp-config-chain--slots");
  await pointerDrag(compactChain.locator(".tp-config-block").filter({ hasText: "Dynamic Lead Delay" }), compactChain.locator('[data-chain-slot="10"]'));
  await expect.poll(() => page.evaluate(() => {
    // @ts-expect-error Test-only instrumentation.
    return window.__testRigChainMoves;
  })).toEqual([["lead-delay", 10]]);

  await page.getByRole("button", { name: /Full editor/i }).click();
  const dialog = page.getByRole("dialog");
  await pointerDrag(dialog.locator(".tp-editor-slot").filter({ hasText: "Dynamic Lead Delay" }), dialog.locator('[data-chain-slot="10"]'));
  await expect.poll(() => page.evaluate(() => {
    // @ts-expect-error Test-only instrumentation.
    return window.__testRigChainMoves;
  })).toEqual([["lead-delay", 10], ["lead-delay", 10]]);
});

test("auditions from TonePilot with clear wording and edits a complete Test Rig", async ({ page }) => {
  await page.getByRole("button", { name: "TonePilot", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TonePilot", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the E2E development build.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Vite serves source modules to the E2E development build.
    const { testRigTemplates } = await import("/src/data/demo-data.ts");
    // @ts-expect-error Test-only instrumentation.
    window.__tonePilotAuditions = [];
    const selected = {
      id: "e2e-tone", title: "E2E Amp", author: "QA", description: "Audition journey", captureType: "amp", detectedType: "amp",
      tags: ["amp"], rating: 4, downloads: 10, source: "Tone3000", imageColor: "#62deea", remoteId: 77, remoteKind: "tone-group",
    };
    const selectedModel = { id: "e2e-model", remoteId: 9, name: "E2E A2", architecture: "A2", url: "https://models.test/e2e.nam" };
    useAppStore.setState({
      tones: [selected], selectedToneId: selected.id,
      toneModels: { [selected.id]: [selectedModel] },
      selectedToneModelId: "e2e-model", testRigs: structuredClone(testRigTemplates), selectedTestRigId: "clean",
      toneLoading: false, toneModelLoading: false, auditionBusy: false, auditioningToneId: null, auditionError: null,
      auditionTone: async (tone: { id: string }) => {
        // @ts-expect-error Test-only instrumentation.
        window.__tonePilotAuditions.push(tone.id);
        useAppStore.setState({
          auditioningToneId: tone.id,
          testRigReturn: {
            id: "return-rig",
            name: "Return rig",
            auditionSource: "Tone3000",
            testRigApplied: true,
            audition: {
              tone: structuredClone(selected),
              model: structuredClone(selectedModel),
              captureFile: { path: "/Evil/Engine/Patch/Neural_Amp_Modeler", property: "LoadedClone", value: "Tone 3000 Demo/e2e.nam" },
            },
          },
        });
      },
    });
  });

  const audition = page.getByRole("button", { name: "Audition on HeadRush", exact: true });
  await expect(audition).toBeEnabled();
  await audition.click();
  await expect.poll(() => page.evaluate(() => {
    // @ts-expect-error Test-only instrumentation.
    return window.__tonePilotAuditions;
  })).toEqual(["e2e-tone"]);

  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh rig", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save to rigs", exact: true }).click();
  const saveDialog = page.getByRole("dialog", { name: "Save audition to Rigs" });
  await expect(saveDialog).toBeVisible();
  await expect(saveDialog.getByLabel("Rig name")).toHaveValue("E2E Amp");
  await expect(saveDialog.getByLabel("Add to setlist")).toHaveValue("");
  await saveDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: /Test Rig Studio/i }).click();
  await expect(page.getByText("Capture marker in plan slot 7")).toBeVisible();
  await expect(page.locator(".tp-config-chain--slots > *")).toHaveCount(14);
  await page.getByRole("button", { name: /Full editor/i }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.locator(".tp-editor-slots > *")).toHaveCount(14);
  await expect(editor.getByText("Compatible blocks")).toBeVisible();
});

test("loads the shared IR file picker styles when TonePilot is the first editor opened", async ({ page }) => {
  // Begin on the dashboard without visiting Rig Editor. The picker is shared
  // by both workspaces and must own its styles instead of relying on route order.
  await page.getByRole("button", { name: "TonePilot", exact: true }).click();
  await page.getByRole("tab", { name: /Test Rig Studio/i }).click();
  await page.getByRole("button", { name: /Full editor/i }).click();

  const editor = page.getByRole("dialog", { name: /Edit .*Clean/i });
  await editor.locator(".tp-editor-slot").filter({ hasText: "IR Loader" }).click();

  const control = editor.locator(".device-file-control");
  const browse = control.locator(".device-file-control__browse");
  await expect(control).toBeVisible();
  await expect(control).toHaveCSS("display", "grid");
  await expect(control).toHaveCSS("overflow", "hidden");
  await expect(browse).toHaveCSS("display", "grid");
  await expect(control.locator(".device-file-control__action")).toHaveCSS("display", "flex");
  expect((await control.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(" ")).toHaveLength(3);

  await browse.click();
  const fileDialog = page.getByRole("dialog", { name: "Choose IR file" });
  const browser = fileDialog.locator(".device-asset-browser");
  const toolbar = browser.locator(".device-asset-browser__toolbar");
  const list = browser.locator(".device-asset-browser__list");
  await expect(fileDialog).toBeVisible();
  await expect(browser).toHaveCSS("display", "grid");
  await expect(toolbar).toHaveCSS("display", "grid");
  await expect(list).toHaveCSS("display", "grid");
  expect(await list.evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(250);
  expect((await list.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(" ")).toHaveLength(2);

  await page.setViewportSize({ width: 560, height: 900 });
  await expect(list).toBeVisible();
  expect((await list.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(" ")).toHaveLength(1);
});

test("configures StageHand with input-only MIDI and no outbound-only remotes", async ({ page }) => {
  await page.getByRole("button", { name: "StageHand", exact: true }).click();
  await page.getByRole("button", { name: /Edit layout/i }).click();
  const controlTab = page.getByRole("tab", { name: /^Control/ });
  await expect(controlTab).toBeDisabled();
  await page.locator(".live-pad").first().click();
  await expect(controlTab).toBeEnabled();
  await expect(controlTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("External MIDI controller")).toBeVisible();
  await expect(page.getByText(/applies supported actions through the HeadRush reflection API/i)).toBeVisible();
  await page.getByRole("button", { name: /Add control/i }).last().click();
  const palette = page.getByRole("dialog", { name: /Add StageHand control/i });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("tab", { name: /Practice & pedal/i })).toHaveCount(0);
  await expect(palette.getByRole("tab", { name: /Looper/i })).toHaveCount(0);
  await expect(palette.getByRole("button", { name: /^PRACTICE TOOL REMOTE/i })).toHaveCount(0);
  await expect(palette.getByRole("button", { name: /^LOOPER/i })).toHaveCount(0);
});

test("executes a StageHand control and gives visible performance feedback", async ({ page }) => {
  await page.getByRole("button", { name: "StageHand", exact: true }).click();
  await page.locator(".live-pad").filter({ hasText: "SCENE B" }).click();
  await expect(page.getByRole("status")).toContainText(/Scene B applied/i);
});

test("keeps StageHand multi-button deck text inside its controls without overlap", async ({ page }) => {
  await page.getByRole("button", { name: "StageHand", exact: true }).click();
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves these browser-only modules during E2E tests.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    // @ts-expect-error Vite serves these browser-only modules during E2E tests.
    const { actionPalette } = await import("/src/data/demo-data.ts");
    const source = actionPalette.find((item: { group: string; widgetLayout?: string }) => item.group === "Drum decks" && item.widgetLayout === "2x3");
    useAppStore.setState((state: { liveLayout: Record<string, unknown>; liveStages: Array<Record<string, unknown>>; selectedLiveStageId: string }) => {
      const buttons = Array(8).fill(null);
      buttons[0] = { ...source, id: "e2e-compact-deck", widgetSize: "1x1" };
      const layout = { ...state.liveLayout, rows: 2, columns: 4, firstRowColumns: 4, locked: true, buttons };
      return { liveLayout: layout, liveStages: state.liveStages.map((stage) => stage.id === state.selectedLiveStageId ? { ...stage, layout } : stage) };
    });
  });

  const pad = page.locator(".live-pad--multibutton");
  await expect(pad).toBeVisible();
  await expect(pad.locator(".stage-widget--footprint-1x1")).toBeVisible();

  const hasNoOverlap = async () => pad.evaluate((container) => {
    const slot = container.querySelector(".live-pad__slot")?.getBoundingClientRect();
    const header = container.querySelector(".stage-widget--multi header")?.getBoundingClientRect();
    const grid = container.querySelector(".stage-widget-deck-grid")?.getBoundingClientRect();
    if (!slot || !header || !grid || header.top < slot.bottom + 3 || grid.top < header.bottom - 1) return false;
    return Array.from(container.querySelectorAll(".stage-widget-deck-grid button")).every((button) => {
      const buttonBox = button.getBoundingClientRect();
      const visibleChildren = Array.from(button.children).filter((child) => getComputedStyle(child).display !== "none");
      const boxes = visibleChildren.map((child) => child.getBoundingClientRect());
      const contained = boxes.every((box) => box.left >= buttonBox.left - 1 && box.right <= buttonBox.right + 1 && box.top >= buttonBox.top - 1 && box.bottom <= buttonBox.bottom + 1);
      const separate = boxes.every((box, index) => boxes.slice(index + 1).every((other) => Math.min(box.right, other.right) - Math.max(box.left, other.left) <= 0 || Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) <= 0));
      return contained && separate;
    });
  });
  expect(await hasNoOverlap()).toBe(true);

  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only module during E2E tests.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    useAppStore.getState().updateLiveButton("e2e-compact-deck", { widgetSize: "1x2" });
  });
  await expect(pad.locator(".stage-widget--footprint-1x2")).toBeVisible();
  expect(await hasNoOverlap()).toBe(true);

  await page.setViewportSize({ width: 560, height: 900 });
  await pad.scrollIntoViewIfNeeded();
  expect(await hasNoOverlap()).toBe(true);
});

test("keeps the Rig Editor assignment, scene and expression studios fully styled", async ({ page }) => {
  await page.getByRole("button", { name: /^Rig Editor/ }).click();
  await page.getByRole("tab", { name: /Footswitches & scenes/i }).click();

  const footswitchBoard = page.locator(".footswitch-board--smart");
  await expect(footswitchBoard).toBeVisible();
  await expect(footswitchBoard).toHaveCSS("display", "grid");
  expect((await footswitchBoard.locator(".smart-footswitch").first().boundingBox())?.height ?? 0).toBeGreaterThan(240);

  const sceneEditorDisplay = await page.evaluate(() => {
    const dialog = document.createElement("div");
    const editor = document.createElement("div");
    dialog.className = "scene-assignment-dialog";
    editor.className = "visual-scene-editor";
    dialog.append(editor);
    document.body.append(dialog);
    const display = getComputedStyle(editor).display;
    dialog.remove();
    return display;
  });
  expect(sceneEditorDisplay).toBe("grid");

  await page.getByRole("tab", { name: "Expression", exact: true }).click();
  const expressionWorkspace = page.locator(".expression-studio__workspace");
  await expect(expressionWorkspace).toBeVisible();
  await expect(expressionWorkspace).toHaveCSS("display", "grid");
  expect((await page.locator(".expression-pedal-stage").boundingBox())?.height ?? 0).toBeGreaterThan(150);
});

test("keeps the change-history before action inside its row", async ({ page }) => {
  await page.evaluate(async () => {
    // This is a layout regression test, so inject the required history state
    // directly instead of coupling it to persistence timing and a page reload.
    // @ts-expect-error Vite serves this browser-only module during E2E tests.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const historicalRig = { id: "rig-1", name: "Neon Boulevard", author: "RushLink", color: "#7c5cff", tags: [], tempo: 124, favorite: true, modified: "Now", blocks: [] };
    useAppStore.setState({ rigHistory: { "rig-1": [{ id: "history-overflow", rigId: "rig-1", createdAt: new Date().toISOString(), description: "Changed an exceptionally long amplifier presence parameter description", before: historicalRig, after: historicalRig, saved: false }] } });
  });
  await page.getByRole("button", { name: /^Rig Editor/ }).click();
  await page.setViewportSize({ width: 780, height: 900 });

  const currentState = page.locator(".history-entry--current");
  await expect(currentState).toBeVisible();
  await expect(currentState).toHaveCSS("position", "relative");

  const before = page.getByRole("button", { name: /Preview state before Changed an exceptionally long/i });
  await expect(before).toBeVisible();
  await expect(before).toContainText("Before");
  const contained = await before.evaluate((button) => button.scrollWidth <= button.clientWidth + 1);
  expect(contained).toBe(true);
});

test("keeps Input, Mix and Output editors useful without redundant control counts", async ({ page }) => {
  await page.getByRole("button", { name: /^Rig Editor/ }).click();
  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(async () => {
    // The demo device omits routing reflection objects, so supply the same
    // metadata shape returned by a connected Flex Prime for this layout check.
    // @ts-expect-error Vite serves this browser-only module during E2E tests.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const object = (properties: string[]) => ({
      meta: { properties: Object.fromEntries(properties.map((property) => [property, { type: "number", minimum: 0, maximum: 1 }])) },
      value: Object.fromEntries(properties.map((property) => [property, 0.5])),
    });
    useAppStore.setState((state) => ({
      liveSubtree: {
        ...(state.liveSubtree ?? {}),
        "/Evil/Engine/Patch/Input": object(["RigInput", "InputGain", "Lock", "GateThresh", "GateRelease", "FilterThreshold", "PPTInGain", "PPTMono", "PPTRange", "PPTTrigThresh", "PPTEndThresh", "PPTRetrigger"]),
        "/Evil/Engine/Patch/Mix": object(["Para1Level", "Para1Pan", "Para2Level", "Para2Pan", "ParaDelay", "ParaXFade"]),
        "/Evil/Engine/Patch/Output": object(["RigVolume", "RigWidth"]),
      },
    }));
  });

  // Input and Output exercise the shared section header. Mix uses identical
  // markup but is intentionally disabled on this demo's straight signal path.
  for (const node of ["INPUT", "OUTPUT"]) {
    const button = page.locator(".signal-node-buttons button").filter({ hasText: node });
    await expect(button).toBeEnabled();
    await button.click();

    const editor = page.locator(".routing-editor");
    await expect(editor.locator(".routing-editor__sections > section").first()).toBeVisible();
    await expect(editor.locator(".reflection-control").first()).toBeVisible();
    await expect(editor.locator(".routing-control-count")).toHaveCount(0);
  }
});

test("keeps Choose a block model names readable instead of truncating them", async ({ page }) => {
  await page.getByRole("button", { name: /^Rig Editor/ }).click();
  await page.locator(".add-block").first().click();

  const catalogue = page.locator(".block-browser--catalogue");
  const cards = catalogue.locator(".block-choice-card");
  await expect(catalogue.getByRole("heading", { name: "Choose a block" })).toBeVisible();
  await expect(cards.first()).toBeVisible();

  const desktopCardsAreReadable = await cards.evaluateAll((items) => items.every((card) => {
    const name = card.querySelector("strong");
    const box = card.getBoundingClientRect();
    if (!name) return false;
    const style = getComputedStyle(name);
    return box.height >= 74
      && box.width >= 240
      && style.whiteSpace === "normal"
      && name.scrollWidth <= name.clientWidth + 1
      && name.scrollHeight <= name.clientHeight + 1;
  }));
  expect(desktopCardsAreReadable).toBe(true);

  await page.setViewportSize({ width: 520, height: 900 });
  await cards.first().scrollIntoViewIfNeeded();
  const mobileCardsAreContained = await cards.evaluateAll((items) => items.slice(0, 5).every((card) => {
    const grid = card.closest(".block-browser__grid--catalogue")?.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const name = card.querySelector("strong");
    return Boolean(grid && name)
      && box.left >= grid!.left - 1
      && box.right <= grid!.right + 1
      && name!.scrollWidth <= name!.clientWidth + 1;
  }));
  expect(mobileCardsAreContained).toBe(true);
});

test("loads a rig for playing without forcing the editor open", async ({ page }) => {
  await page.getByRole("button", { name: /^Rigs & Setlists/ }).click();
  const play = page.getByRole("button", { name: /Load and play .* without opening the editor/i }).nth(1);
  const label = await play.getAttribute("aria-label");
  await play.click();
  await expect(page.locator(".topbar__title")).toContainText("Rigs & Setlists");
  expect(label).toContain("without opening the editor");
  await expect(page.locator(".rig-library-card.selected")).toContainText(label?.replace(/^Load and play | without opening the editor$/g, "").trim() ?? "");
});

test("keeps the loaded rig Playing label inside its Setlists workspace action", async ({ page }) => {
  await page.getByRole("button", { name: /^Rigs & Setlists/ }).click();
  await page.evaluate(async () => {
    // The browser demo has no loaded device rig; mirror the minimum connected
    // snapshot required to render the real Playing state.
    // @ts-expect-error Vite serves this browser-only module during E2E tests.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    useAppStore.setState((state) => ({ liveSnapshot: {
      syncedAt: new Date().toISOString(), objectCount: 0, deviceName: "Flex Prime", firmware: "Demo", rig: state.rigs[0],
      routing: { id: 0, label: "Straight", stereo: false, tails: false, locked: false }, rigLibrary: [], setlists: [], loadedSetlistId: "", loadedSetlistName: "",
      footswitches: [], currentScene: 0, drums: { playing: false, muted: false, kit: "", style: "" }, storage: { usedPercent: 0, usedLabel: "", capacityLabel: "" }, cpuPercent: 0,
      cloud: { loggedIn: false, loading: false, demo: "" }, tone3000: { loggedIn: false, searching: false }, settings: { audio: {}, general: {}, midi: {}, expression: {}, pedal1: {}, pedal2: {} },
    } }));
  });
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.getByRole("tab", { name: "List", exact: true }).click();

  const playing = page.locator(".rig-library-card.loaded .rig-play-action");
  await expect(playing).toBeVisible();
  await expect(playing).toContainText("Playing");
  const contained = await playing.evaluate((button) => {
    const buttonBox = button.getBoundingClientRect();
    const labelBox = button.querySelector("span")?.getBoundingClientRect();
    const actionsBox = button.closest(".rig-library-card__actions")?.getBoundingClientRect();
    return Boolean(labelBox && actionsBox)
      && labelBox!.left >= buttonBox.left - 1
      && labelBox!.right <= buttonBox.right + 1
      && buttonBox.right <= actionsBox!.right + 1;
  });
  expect(contained).toBe(true);
});

test("shows a useful designed state when the favourites collection is empty", async ({ page }) => {
  await page.getByRole("button", { name: /^Rigs & Setlists/ }).click();
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser-only module during E2E tests.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    useAppStore.setState({ favoriteRigIds: [] });
  });
  await page.getByRole("button", { name: "Favourites", exact: true }).click();

  const empty = page.getByRole("status");
  await expect(empty).toHaveClass(/rig-library-empty--favorites/);
  await expect(empty.getByRole("heading", { name: "Save the rigs you reach for" })).toBeVisible();
  await expect(empty).toContainText("Use the heart on any rig");
  await empty.getByRole("button", { name: "Browse all rigs" }).click();
  await expect(page.locator(".rig-library-card").first()).toBeVisible();
});

test("does not present unsupported tuning metadata as device setlist data", async ({ page }) => {
  await page.getByRole("button", { name: /^Rigs & Setlists/ }).click();
  await page.locator(".library-section-switcher > button").filter({ hasText: "Setlists" }).click();

  await expect(page.getByText("CURRENT RIG", { exact: true })).toBeVisible();
  await expect(page.getByText("TUNINGS", { exact: true })).toHaveCount(0);
  await expect(page.getByText("TUNING", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Drop D", { exact: true })).toHaveCount(0);
  await expect(page.locator(".setlist-run-columns > span")).toHaveCount(5);
});

test("keeps the Drummer new-preset action aligned with its name field", async ({ page }) => {
  await page.getByRole("button", { name: /^Performance Tools/ }).click();
  await page.getByRole("button", { name: /^Presets/ }).click();

  const dialog = page.getByRole("dialog", { name: "Drummer presets" });
  const createPanel = dialog.locator(".drum-preset-create");
  const name = dialog.getByLabel("New drummer preset name");
  const create = dialog.getByRole("button", { name: "Create preset" });
  await expect(createPanel).toHaveCSS("display", "flex");
  await expect(create).toBeDisabled();
  await name.fill("QA Groove");
  await expect(create).toBeEnabled();

  const desktopAligned = await createPanel.evaluate((panel) => {
    const input = panel.querySelector("input")?.getBoundingClientRect();
    const button = panel.querySelector("button")?.getBoundingClientRect();
    return Boolean(input && button) && button!.left >= input!.right + 5 && Math.abs(button!.bottom - input!.bottom) <= 2;
  });
  expect(desktopAligned).toBe(true);

  await page.setViewportSize({ width: 640, height: 900 });
  await create.scrollIntoViewIfNeeded();
  const mobileContained = await createPanel.evaluate((panel) => {
    const panelBox = panel.getBoundingClientRect();
    const input = panel.querySelector("input")?.getBoundingClientRect();
    const button = panel.querySelector("button")?.getBoundingClientRect();
    return Boolean(input && button)
      && button!.top >= input!.bottom + 5
      && button!.left >= panelBox.left
      && button!.right <= panelBox.right;
  });
  expect(mobileContained).toBe(true);
});

test("keeps device tuner modes compact and control groups comfortably separated", async ({ page }) => {
  await page.getByRole("button", { name: /^Performance Tools/ }).click();

  const controls = page.locator(".device-tuner .tuner-controls");
  const power = controls.locator(".tuner-control__power");
  const mode = controls.locator(".tuner-control--mode");
  const reference = controls.locator(".tuner-control--reference");
  await expect(controls).toBeVisible();

  const desktopLayout = await controls.evaluate((container) => {
    const containerBox = container.getBoundingClientRect();
    const boxes = Array.from(container.children).map((child) => child.getBoundingClientRect());
    const widths = boxes.map((box) => box.width);
    return boxes.length === 4
      && boxes.every((box) => box.left >= containerBox.left - 1 && box.right <= containerBox.right + 1)
      && boxes.every((box) => Math.abs(box.top - boxes[0].top) <= 1)
      && boxes.slice(1).every((box, index) => box.left - boxes[index].right >= 8)
      && Math.max(...widths) / Math.min(...widths) < 1.9;
  });
  expect(desktopLayout).toBe(true);

  await page.setViewportSize({ width: 620, height: 900 });
  await controls.scrollIntoViewIfNeeded();
  await expect(power).toBeVisible();
  await expect(mode).toBeVisible();
  await expect(reference).toBeVisible();

  const mobileLayout = await controls.evaluate((container) => {
    const containerBox = container.getBoundingClientRect();
    const boxes = Array.from(container.children).map((child) => child.getBoundingClientRect());
    const contained = boxes.every((box) => box.left >= containerBox.left - 1 && box.right <= containerBox.right + 1);
    const separated = boxes.slice(1).every((box, index) => box.top - boxes[index].bottom >= 7);
    const modeButtons = Array.from(container.querySelectorAll(".mode-buttons button"));
    const touchFriendly = modeButtons.every((button) => button.getBoundingClientRect().height >= 40);
    return contained && separated && touchFriendly;
  });
  expect(mobileLayout).toBe(true);
});

test("opens the input-only MIDI controller configuration", async ({ page }) => {
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: /^MIDI/ }).click();
  await expect(page.getByRole("heading", { name: "External controller input" })).toBeVisible();
  await expect(page.getByText(/RushLink receives external MIDI as input/i)).toBeVisible();
  await expect(page.getByText(/External MIDI can trigger supported StageHand/i)).toBeVisible();
  await expect(page.getByText(/Looper and Practice Tool remotes remain hidden/i)).toBeVisible();
  await expect(page.getByLabel("MIDI input")).toBeVisible();
  await expect(page.getByLabel("MIDI output")).toHaveCount(0);
});

test("keeps primary interactive controls accessible by name", async ({ page }) => {
  const unnamed = await page.locator("button").evaluateAll((buttons) => buttons.filter((button) => {
    const aria = button.getAttribute("aria-label")?.trim();
    const title = button.getAttribute("title")?.trim();
    return !aria && !title && !(button.textContent ?? "").trim();
  }).length);
  expect(unnamed).toBe(0);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("nav")).toHaveAttribute("class", /sidebar__nav/);
});

test("shows the real computed focus treatment on text fields", async ({ page }) => {
  await page.getByRole("button", { name: /^Rigs & Setlists/ }).click();
  const search = page.getByRole("textbox", { name: /Search by rig, author or tag/i });
  const computedTreatment = () => search.evaluate((input) => {
    const inputStyle = getComputedStyle(input);
    const wrapper = input.closest(".search-input");
    const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
    return {
      active: document.activeElement === input,
      inputOutline: inputStyle.outlineStyle,
      inputShadow: inputStyle.boxShadow,
      wrapperBorder: wrapperStyle?.borderColor ?? "",
      wrapperShadow: wrapperStyle?.boxShadow ?? "",
    };
  });
  const resting = await computedTreatment();
  await search.focus();
  const focused = await computedTreatment();

  expect(resting.active).toBe(false);
  expect(focused.active).toBe(true);
  expect({ outline: focused.inputOutline, inputShadow: focused.inputShadow, border: focused.wrapperBorder, wrapperShadow: focused.wrapperShadow })
    .not.toEqual({ outline: resting.inputOutline, inputShadow: resting.inputShadow, border: resting.wrapperBorder, wrapperShadow: resting.wrapperShadow });
});

test("keeps primary navigation usable in a phone-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.locator(".app")).toHaveClass(/app--mobile-nav-open/);

  await page.getByRole("button", { name: "StageHand", exact: true }).click();
  await expect(page.getByRole("heading", { name: "StageHand", exact: true })).toBeVisible();
  await expect(page.locator(".app")).not.toHaveClass(/app--mobile-nav-open/);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "TonePilot", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TonePilot", exact: true })).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
});
