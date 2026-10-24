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

suite("toCron — DST-style offset changes", () => {
  // `toCron` converts with the local offset that will hold at the schedule's
  // next occurrence, so the stored cron line stays correct through the next
  // DST change. Nothing re-converts an already-stored line when a later
  // change comes around, though — that stays off until the next install.
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

suite("toCron — DST boundary: offset at the next occurrence", () => {
  // Europe/Paris 2026: CEST (+2) until Sun 2026-10-25 03:00 local, then CET
  // (+1); back to CEST on Sun 2026-03-29 02:00 local. All conversions run
  // against a UTC server (offset 0), so the cron line is UTC wall time.
  test("weekdays 10:00 picked before the fall-back fires at 10:00 after it (the reported bug)", () => {
    process.env.TZ = "Europe/Paris";
    const from = at("2026-10-24T12:00:00"); // Sat, 14:00 CEST
    // Next weekday 10:00 local is Mon 2026-10-26, already CET (+1) → 09:00 UTC.
    expect(toCron(weekdays(10, 0), 0, from)).toBe("0 9 * * 1,2,3,4,5");
    const next = nextRun(toCron(weekdays(10, 0), 0, from), 0, from);
    expect(next).toBe(at("2026-10-26T09:00:00"));
    expect(new Date(next!).getHours()).toBe(10); // 10:00 local in Paris
  });

  test("weekdays 9:00 picked before the fall-back fires at 9:00 after it", () => {
    process.env.TZ = "Europe/Paris";
    const from = at("2026-10-24T12:00:00");
    expect(toCron(weekdays(9, 0), 0, from)).toBe("0 8 * * 1,2,3,4,5");
    expect(nextRun("0 8 * * 1,2,3,4,5", 0, from)).toBe(at("2026-10-26T08:00:00"));
    expect(new Date(at("2026-10-26T08:00:00")).getHours()).toBe(9);
  });

  test("a run still ahead of the fall-back keeps the summer offset", () => {
    process.env.TZ = "Europe/Paris";
    const from = at("2026-10-24T06:00:00"); // Sat, 08:00 CEST; today's 10:00 is before the change
    expect(toCron(daily(10, 0), 0, from)).toBe("0 8 * * *");
  });

  test("daily 10:00 lands on the spring-forward day and picks the summer offset", () => {
    process.env.TZ = "Europe/Paris";
    const from = at("2026-03-28T12:00:00"); // Sat, 13:00 CET
    // Next daily 10:00 is Sun 2026-03-29, when Paris is already CEST (+2) → 08:00 UTC.
    expect(toCron(daily(10, 0), 0, from)).toBe("0 8 * * *");
  });

  test("a run scheduled on the transition day uses the offset at that instant", () => {
    process.env.TZ = "Europe/Paris";
    const from = at("2026-10-25T00:30:00"); // 02:30 CEST; clocks fall back at 01:00 UTC
    expect(toCron(daily(15, 0), 0, from)).toBe("0 14 * * *"); // 15:00 CET = 14:00 UTC
  });

  test("an ambiguous wall time on the fall-back day converts with its earliest occurrence", () => {
    process.env.TZ = "Europe/Paris";
    const from = at("2026-10-24T12:00:00");
    // 02:30 local happens twice on Sun 2026-10-25 (00:30 UTC CEST, 01:30 UTC
    // CET); the earliest still uses the summer offset (+2) → 00:30 UTC.
    expect(toCron(daily(2, 30), 0, from)).toBe("30 0 * * *");
  });

  test("normal dates in Paris convert with the offset in force, summer and winter", () => {
    process.env.TZ = "Europe/Paris";
    // Summer: next weekday 10:00 (Mon 2026-06-16) is CEST → 08:00 UTC.
    expect(toCron(weekdays(10, 0), 0, at("2026-06-15T12:00:00"))).toBe("0 8 * * 1,2,3,4,5");
    // Winter: next weekday 10:00 (Fri 2026-01-16) is CET → 09:00 UTC.
    expect(toCron(weekdays(10, 0), 0, at("2026-01-15T12:00:00"))).toBe("0 9 * * 1,2,3,4,5");
  });

  test("weekly crosses the fall-back with the right day list and time", () => {
    process.env.TZ = "Europe/Paris";
    const from = at("2026-10-24T12:00:00");
    // Mondays at 10:00 local: next is Mon 2026-10-26 CET → 09:00 UTC.
    expect(toCron(weekly([1], 10, 0), 0, from)).toBe("0 9 * * 1");
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
