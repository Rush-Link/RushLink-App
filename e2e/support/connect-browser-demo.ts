import { expect, type Page } from "@playwright/test";

/** Connect through the public UI so the same setup works against Vite dev and
 * optimized production output; production builds do not expose source modules. */
export async function connectBrowserDemo(page: Page) {
  const gate = page.getByRole("dialog", { name: /Connect to your device/i });
  if (await gate.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await gate.getByRole("button", { name: /^Connect to your device$/i }).click();
    await expect(gate).not.toBeVisible();
  }

  const welcome = page.getByRole("dialog", { name: /Welcome to RushLink by Cygma Audio/i });
  const onboardingAppeared = await welcome.waitFor({ state: "visible", timeout: 2_500 })
    .then(() => true)
    .catch(() => false);
  if (onboardingAppeared) {
    await welcome.getByRole("button", { name: /Continue/i }).click();
    const safety = page.getByRole("dialog", { name: /Choose how changes reach the pedal/i });
    await expect(safety).toBeVisible();
    await safety.getByRole("button", { name: /Apply immediately/i }).click();
    await expect(safety).not.toBeVisible();
  }
}
