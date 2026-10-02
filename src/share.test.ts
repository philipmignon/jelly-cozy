import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "./share";

describe("save backup codes", () => {
  it("round-trip a save, names with emoji and accents included", () => {
    const json = JSON.stringify({ v: 8, slots: [{ k: 0, g: 3, name: "Mochi 🍡" }, null], dollars: 412, journal: [{ firstName: "Pâte" }] });
    const code = encodeSave(json);
    expect(code.startsWith("JTSAVE1.")).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(decodeSave(code)).toBe(json);
    expect(decodeSave(`  ${code}\n`)).toBe(json);
  });

  it("refuses anything that isn't a save", () => {
    expect(decodeSave("")).toBeNull();
    expect(decodeSave("hello")).toBeNull();
    expect(decodeSave("JTSAVE1.!!!")).toBeNull();
    expect(decodeSave(encodeSave(JSON.stringify({ hello: 1 })))).toBeNull();
    expect(decodeSave(encodeSave("not json"))).toBeNull();
  });
});
