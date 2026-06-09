import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  addRosterEmployee,
  listRoster,
  removeRosterEmployee,
} from "../../../src/agent/daily-report-digest/daily-report-roster-store";

const SAMPLE = {
  title: "每日日报汇总",
  timezone: "Asia/Shanghai",
  orgs: [
    {
      label: "明思",
      useDeployedAppCredentials: true,
      employees: [{ userid: "ms-1", name: "李嘉男" }],
    },
    {
      label: "微光",
      appKey: "WG_KEY",
      appSecret: "WG_SECRET_XYZ",
      employees: [{ userid: "wg-1", name: "曹杰" }],
    },
  ],
};

describe("daily-report-roster-store", () => {
  let file: string;

  beforeEach(() => {
    file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "roster-")),
      "daily-report-digest.json",
    );
    fs.writeFileSync(file, JSON.stringify(SAMPLE, null, 2), "utf8");
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("lists orgs with credential flag", () => {
    const view = listRoster({ filePath: file });
    expect(view.map((o) => o.label)).toEqual(["明思", "微光"]);
    expect(view[0].usesDeployedCredentials).toBe(true);
    expect(view[1].usesDeployedCredentials).toBe(false);
    expect(view[1].employees).toEqual([{ userid: "wg-1", name: "曹杰" }]);
  });

  it("adds an employee and preserves secrets on disk", () => {
    const view = addRosterEmployee(
      "微光",
      { userid: "wg-2", name: "薛婷" },
      { filePath: file },
    );
    const wg = view.find((o) => o.label === "微光");
    expect(wg?.employees.map((e) => e.userid)).toEqual(["wg-1", "wg-2"]);

    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    const wgRaw = onDisk.orgs.find((o: { label: string }) => o.label === "微光");
    expect(wgRaw.appSecret).toBe("WG_SECRET_XYZ");
    expect(wgRaw.appKey).toBe("WG_KEY");
    expect(wgRaw.employees).toHaveLength(2);
  });

  it("dedupes when adding an existing userid", () => {
    addRosterEmployee("微光", { userid: "wg-1", name: "曹杰" }, { filePath: file });
    const view = listRoster({ filePath: file });
    expect(view.find((o) => o.label === "微光")?.employees).toHaveLength(1);
  });

  it("removes an employee", () => {
    const view = removeRosterEmployee("明思", "ms-1", { filePath: file });
    expect(view.find((o) => o.label === "明思")?.employees).toHaveLength(0);
  });

  it("throws for an unknown org", () => {
    expect(() =>
      addRosterEmployee("不存在", { userid: "x" }, { filePath: file }),
    ).toThrow(/未找到组织/);
  });

  it("does not touch the file when removing a missing userid", () => {
    const before = fs.readFileSync(file, "utf8");
    removeRosterEmployee("微光", "nope", { filePath: file });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});
