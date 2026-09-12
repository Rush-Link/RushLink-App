import { expect, test, type Page } from "@playwright/test";
import { connectBrowserDemo } from "./support/connect-browser-demo";
import { tabletViewports } from "./support/tablet-viewports";

const routes = [
  ["dashboard", ".page-dashboard"], ["editor", ".editor-page"], ["rigs", ".device-library-page"],
  ["setlists", ".setlist-library-page"], ["live", ".stagehand-v2"], ["tone-cloud", ".tone-page"],
  ["assignments", ".assignments-page"], ["tools", ".performance-studio-page"],
  ["library", ".backup-page"], ["settings", ".settings-page"], ["diagnostics", ".diagnostic-summary"],
] as const;

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1420" ? route.continue() : route.abort());
});

async function openApp(page: Page) {
  await page.goto("/");
  await connectBrowserDemo(page);
  await expect(page.locator(".app")).toHaveClass(/app--tablet/);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".statusbar")).toBeHidden();
  await expect(page.getByRole("button", { name: "Expand navigation", exact: true })).toBeVisible();
}

async function visit(page: Page, id: string, ready: string) {
  await page.evaluate(async id => {
    // @ts-expect-error Vite test instrumentation, never included in an installer.
    const { useAppStore } = await import("/src/stores/app-store.ts");
    useAppStore.getState().setPage(id);
  }, id);
  await expect(page.locator(ready).first()).toBeVisible();
}

async function measurements(page: Page) {
  return page.locator(".app-workspace").evaluate(root => {
    const visible = (element: Element) => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== "hidden" && !element.closest("[hidden]"); };
    const describe = (element: Element) => ({ selector: element.className, label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 60), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height });
    const overflow = [...root.querySelectorAll("*")].filter(visible).filter(element => {
      const r = element.getBoundingClientRect();
      if (r.right <= innerWidth + 1) return false;
      for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(parent).overflowX)) return false;
      }
      return true;
    }).map(describe);
    const small = [...root.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), [role=switch], [role=tab]")].filter(visible).filter(element => {
      const r = element.getBoundingClientRect(); return r.width < 43 || r.height < 43;
    }).map(describe);
    return { overflow, small };
  });
}

for (const [short, long] of tabletViewports) {
  for (const [width, height] of [[short, long], [long, short]]) {
    test(`tablet workspaces fit ${width}x${height}`, async ({ page }, testInfo) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height });
      await openApp(page);
      const report = [];
      for (const expanded of [false, true]) {
        if (expanded) await page.getByRole("button", { name: "Expand navigation", exact: true }).tap();
        await expect(page.locator(".sidebar")).toBeVisible();
        for (const [id, ready] of routes) {
          await visit(page, id, ready);
          const result = await measurements(page);
          report.push({ id, expanded, ...result });
          expect.soft(result.overflow, `${id}, menu ${expanded ? "expanded" : "collapsed"}: overflow`).toEqual([]);
          expect.soft(result.small, `${id}, menu ${expanded ? "expanded" : "collapsed"}: touch targets`).toEqual([]);
        }
      }
      await testInfo.attach("workspace-measurements", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    });
  }
}
