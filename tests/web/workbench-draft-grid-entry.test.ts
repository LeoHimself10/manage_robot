import { describe, expect, it } from "vitest";

import { fitDraftTextarea } from "../../src/web/workbench-draft-grid-entry";
import { WORKBENCH_APP_BASE_CSS } from "../../src/web/workbench-app-styles";

describe("workbench draft grid text visibility", () => {
  it("resizes a long-text field to its complete content and can shrink again", () => {
    const field = {
      scrollHeight: 132,
      style: { height: "" },
    } as unknown as HTMLTextAreaElement;

    fitDraftTextarea(field);
    expect(field.style.height).toBe("132px");

    Object.defineProperty(field, "scrollHeight", { value: 66, configurable: true });
    fitDraftTextarea(field);
    expect(field.style.height).toBe("66px");
  });

  it("keeps textarea scrolling at the outer table level", () => {
    expect(WORKBENCH_APP_BASE_CSS).toMatch(
      /\.draft-excel-table textarea\.cell-input \{[\s\S]*?overflow-y: hidden;[\s\S]*?resize: none;/,
    );
  });
});
