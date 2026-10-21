import { beforeEach, describe, expect, it } from "vitest";

import type { LogEntry } from "@/types/domain";

import { useLogStore } from "./log-store";

const entry = (id: number): LogEntry => ({ id, timestamp: id, level: "info", message: `entry ${id}` });

describe("log store", () => {
  beforeEach(() => {
    useLogStore.getState().clear();
  });

  it("appends entries in order", () => {
    useLogStore.getState().append(entry(1));
    useLogStore.getState().append(entry(2));
    expect(useLogStore.getState().entries.map((item) => item.id)).toEqual([1, 2]);
  });

  it("ignores an entry that is already present", () => {
    useLogStore.getState().replace([entry(1), entry(2)]);
    useLogStore.getState().append(entry(2));
    expect(useLogStore.getState().entries).toHaveLength(2);
  });

  it("keeps only the most recent entries", () => {
    useLogStore.getState().replace(Array.from({ length: 600 }, (_, index) => entry(index)));
    const { entries } = useLogStore.getState();
    expect(entries).toHaveLength(500);
    expect(entries[0]?.id).toBe(100);
  });
});
