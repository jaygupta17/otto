import { afterEach, beforeEach, describe as suite, expect, setSystemTime, test } from "bun:test";
import { describe, nextRun, parseField, toCron, validCron } from "./scheduleCore";
import type { Frequency } from "./scheduleCore";

/** "2026-01-01T00:00:00" → epoch ms (UTC). */
const at = (iso: string) => Date.parse(`${iso}Z`);

const daily = (hour: number, minute = 0): Frequency => ({ kind: "daily", hour, minute });
const weekdays = (hour: number, minute = 0): Frequency => ({ kind: "weekdays", hour, minute });
const weekly = (days: number[], hour: number, minute = 0): Frequency => ({ kind: "weekly", days, hour, minute });

// `toCron` reads the machine's local offset and the clock, so pin both. Bun
// applies `process.env.TZ` and `setSystemTime` dynamically.
beforeEach(() => {
  process.env.TZ = "UTC";
  setSystemTime(new Date("2026-06-15T12:00:00Z"));
});

afterEach(() => {
  setSystemTime();
  process.env.TZ = "UTC";
});

suite("toCron — cron conversion in server time", () => {
  test("hourly keeps the minute when the offset has no sub-hour part", () => {
    expect(toCron({ kind: "hourly", minute: 15 }, 0)).toBe("15 * * * *");
    expect(toCron({ kind: "hourly", minute: 15 }, 120)).toBe("15 * * * *");
  });

  test("hourly shifts the minute for sub-hour server offsets, both directions", () => {
    // +05:30 server: 15 + 330 minutes → :45
    expect(toCron({ kind: "hourly", minute: 15 }, 330)).toBe("45 * * * *");
    // -00:30 server: 15 - 30 minutes → :45 (wraps within the hour)
    expect(toCron({ kind: "hourly", minute: 15 }, -30)).toBe("45 * * * *");
    // +00:45 server: 50 + 45 minutes → :35 of the next hour, i.e. :35 every hour
    expect(toCron({ kind: "hourly", minute: 50 }, 45)).toBe("35 * * * *");
  });

  test("daily at the same offset", () => {
    expect(toCron(daily(9, 30), 0)).toBe("30 9 * * *");
  });

  test("daily shifted east (local ahead of server)", () => {
    expect(toCron(daily(9, 0), 330)).toBe("30 14 * * *");
  });

  test("daily shifted west (local behind server)", () => {
    expect(toCron(daily(9, 0), -300)).toBe("0 4 * * *");
  });

  test("daily crosses midnight in both directions", () => {
    expect(toCron(daily(23, 30), 120)).toBe("30 1 * * *");
    expect(toCron(daily(0, 15), -120)).toBe("15 22 * * *");
  });

  test("weekdays roll to the next day and shift the day list", () => {
    // Friday 23:00 local → Saturday 01:00 server
    expect(toCron(weekdays(23, 0), 120)).toBe("0 1 * * 2,3,4,5,6");
  });

  test("weekdays roll to the previous day and shift the day list", () => {
    // Monday 01:00 local → Sunday 23:00 server
    expect(toCron(weekdays(1, 0), -120)).toBe("0 23 * * 0,1,2,3,4");
  });

  test("weekly keeps its days when no day boundary is crossed", () => {
    expect(toCron(weekly([1, 3, 5], 9, 0), 600)).toBe("0 19 * * 1,3,5");
  });

  test("weekly shifts its days when the time crosses midnight", () => {
    // Monday 20:00 local → Tuesday 01:00 server
    expect(toCron(weekly([1], 20, 0), 300)).toBe("0 1 * * 2");
  });

  test("weekly falls back to Monday when no days are selected", () => {
    expect(toCron(weekly([], 9, 0), 0)).toBe("0 9 * * 1");
  });

  test("custom cron passes through untrimmed whitespace only", () => {
    expect(toCron({ kind: "custom", cron: "  */5 * * * *  " }, 330)).toBe("*/5 * * * *");
  });

  test("local timezone ahead of a UTC server shifts backwards", () => {
    process.env.TZ = "Asia/Tokyo"; // +09:00
    setSystemTime(new Date("2026-06-15T12:00:00Z"));
    expect(toCron(daily(9, 0), 0)).toBe("0 0 * * *");
  });

  test("local timezone behind a UTC server shifts forwards", () => {
    process.env.TZ = "America/New_York"; // -04:00 in June
    setSystemTime(new Date("2026-06-15T12:00:00Z"));
    expect(toCron(daily(9, 0), 60)).toBe("0 14 * * *");
  });
});

suite("toCron — DST-style offset changes (current behavior)", () => {
  // Current behavior to be aware of: `toCron` converts with the local offset
  // *at conversion time* and stores a fixed UTC cron line. Nothing rewrites the
  // line when the local or server zone changes, so a schedule saved in summer
  // fires an hour off after the clocks change. This test documents that drift
  // rather than asserting DST correctness.
  test("the same local frequency converts differently in summer and winter", () => {
    process.env.TZ = "America/New_York";

    setSystemTime(new Date("2026-07-01T12:00:00Z")); // EDT, UTC-4
    expect(toCron(daily(9, 0), 0)).toBe("0 13 * * *");

    setSystemTime(new Date("2026-01-15T12:00:00Z")); // EST, UTC-5
    expect(toCron(daily(9, 0), 0)).toBe("0 14 * * *");
  });

  test("a cron line stored in summer is not re-converted for winter", () => {
    // The summer line ("0 13 * * *" UTC) fires at 08:00 EST in January.
    expect(nextRun("0 13 * * *", 0, at("2026-01-15T00:00:00"))).toBe(at("2026-01-15T13:00:00"));
  });
});

suite("nextRun", () => {
  test("returns the next minute, not the current one", () => {
    expect(nextRun("0 0 * * *", 0, at("2026-01-01T00:00:00"))).toBe(at("2026-01-02T00:00:00"));
  });

  test("crosses midnight", () => {
    expect(nextRun("0 1 * * *", 0, at("2026-01-10T23:59:00"))).toBe(at("2026-01-11T01:00:00"));
  });

  test("crosses a month boundary", () => {
    expect(nextRun("0 0 * * *", 0, at("2026-03-31T23:59:00"))).toBe(at("2026-04-01T00:00:00"));
  });

  test("crosses a year boundary", () => {
    expect(nextRun("30 23 * * *", 0, at("2026-12-31T23:45:00"))).toBe(at("2027-01-01T23:30:00"));
  });

  test("crosses a day-of-month boundary", () => {
    expect(nextRun("0 0 1 * *", 0, at("2026-01-15T00:00:00"))).toBe(at("2026-02-01T00:00:00"));
  });

  test("interprets the cron line in server wall time", () => {
    // 09:00 at UTC+05:30 is 03:30 UTC.
    expect(nextRun("0 9 * * *", 330, at("2026-01-01T00:00:00"))).toBe(at("2026-01-01T03:30:00"));
  });

  test("matches day-of-month OR day-of-week when both are set", () => {
    // 2026-01-01 is a Thursday; from Jan 2 the next match is Monday Jan 5.
    expect(nextRun("0 0 1 * 1", 0, at("2026-01-02T00:00:00"))).toBe(at("2026-01-05T00:00:00"));
  });

  test("returns null when the date can never match", () => {
    expect(nextRun("0 0 31 2 *", 0, at("2026-01-01T00:00:00"))).toBeNull();
  });

  test("returns null for malformed cron lines", () => {
    expect(nextRun("0 0 * *", 0, at("2026-01-01T00:00:00"))).toBeNull();
    expect(nextRun("nope", 0, at("2026-01-01T00:00:00"))).toBeNull();
    expect(nextRun("60 0 * * *", 0, at("2026-01-01T00:00:00"))).toBeNull();
  });
});

suite("validCron", () => {
  test("accepts the forms the UI and the tool can produce", () => {
    for (const cron of ["* * * * *", "*/5 9-17 * * 1-5", "0 0 1 1 *", "5,10 3 * * 0,6", "0 0 * * 7"]) {
      expect(validCron(cron)).toBe(true);
    }
  });

  test("rejects out-of-range and malformed fields", () => {
    for (const cron of [
      "60 * * * *",
      "* 24 * * *",
      "* * 0 * *",
      "* * * 13 *",
      "* * * * 8",
      "0 0 * *",
      "0 0 * * * *",
      "a b c d e",
      "*/0 * * * *",
      "5-1 * * * *",
      "1-2-3 * * * *",
    ]) {
      expect(validCron(cron)).toBe(false);
    }
  });
});

suite("parseField", () => {
  test("expands steps, ranges and lists", () => {
    expect([...parseField("*/15", 0, 59)!]).toEqual([0, 15, 30, 45]);
    expect([...parseField("1-5", 1, 31)!]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseField("5-10/2", 0, 59)!]).toEqual([5, 7, 9]);
    expect([...parseField("1,3,5", 0, 59)!]).toEqual([1, 3, 5]);
  });

  test("maps Sunday 7 to 0 in the day-of-week field", () => {
    expect([...parseField("7", 0, 7)!]).toEqual([0]);
  });

  test("returns null for invalid fields", () => {
    expect(parseField("60", 0, 59)).toBeNull();
    expect(parseField("*/0", 0, 59)).toBeNull();
    expect(parseField("5-1", 0, 59)).toBeNull();
    expect(parseField("1-2-3", 0, 59)).toBeNull();
    expect(parseField("", 0, 59)).toBeNull();
  });
});

suite("describe", () => {
  test("labels hourly schedules without locale-dependent time text", () => {
    expect(describe({ kind: "hourly", minute: 0 })).toBe("Every hour");
    expect(describe({ kind: "hourly", minute: 5 })).toBe("Every hour at :05");
  });

  test("shows custom cron verbatim", () => {
    expect(describe({ kind: "custom", cron: "*/5 * * * *" })).toBe("Cron: */5 * * * *");
  });
});
