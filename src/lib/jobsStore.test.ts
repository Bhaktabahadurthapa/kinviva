import { describe, expect, it } from "vitest";
import { pickStored } from "./jobsStore";

describe("pickStored", () => {
  it("prefers the database, imports an old browser copy once, and handles nothing", () => {
    expect(pickStored("db", "local")).toEqual({ value: "db", importToDb: false });
    expect(pickStored("", "local")).toEqual({ value: "", importToDb: false });
    expect(pickStored(null, "local")).toEqual({ value: "local", importToDb: true });
    expect(pickStored(null, null)).toEqual({ value: null, importToDb: false });
  });
});
