import { expect, type Locator } from "@playwright/test";

/** Read rendered colors, including translucent fills and gradient stops. This
 * checks enabled UI text independently of whichever palette tokens produced it. */
export async function expectReadableText(locator: Locator, minimum = 4.5) {
  await expect(locator).toBeVisible();
  await locator.evaluate(async element => {
    const animations: Animation[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      animations.push(...current.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity));
    }
    await Promise.allSettled(animations.map(animation => animation.finished));
  });
  const result = await locator.evaluate(element => {
    type Color = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const color = (value: string): Color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
    };
    const blend = (front: Color, back: Color): Color => [
      front[0] * front[3] + back[0] * (1 - front[3]),
      front[1] * front[3] + back[1] * (1 - front[3]),
      front[2] * front[3] + back[2] * (1 - front[3]), 1,
    ];
    const luminance = (values: Color) => values.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const contrast = (first: Color, second: Color) => (Math.max(luminance(first), luminance(second)) + .05) / (Math.min(luminance(first), luminance(second)) + .05);
    const foreground = color(getComputedStyle(element).color);
    let opacity = 1;
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    let background: Color = [255, 255, 255, 1];
    for (const ancestor of ancestors) {
      const style = getComputedStyle(ancestor);
      opacity *= Number(style.opacity);
      background = blend(color(style.backgroundColor), background);
      // Use the least favorable gradient stop rather than assuming a solid token.
      const stops = style.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)|#[\da-f]{3,8}/gi) ?? [];
      const candidates = stops.map(stop => blend(color(stop), background));
      if (candidates.length) background = candidates.reduce((worst, candidate) => contrast(foreground, candidate) < contrast(foreground, worst) ? candidate : worst);
    }
    foreground[3] *= opacity;
    return { text: element.textContent?.trim(), foreground, background, ratio: contrast(blend(foreground, background), background) };
  });
  expect(result.ratio, `${result.text}: ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(minimum);
}
