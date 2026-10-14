import type { Plugin } from "vite";

import { PLAN_NUMBER_PLACEHOLDERS } from "./planNumbers";

/** Substitutes the plan-number placeholders in the landing entry (`index.html`) only. */
export function planNumbersPlugin(): Plugin {
  return {
    name: "helio-plan-numbers",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.path !== "/index.html") return html;
        return Object.entries(PLAN_NUMBER_PLACEHOLDERS).reduce(
          (out, [placeholder, value]) => out.replaceAll(placeholder, String(value)),
          html,
        );
      },
    },
  };
}
