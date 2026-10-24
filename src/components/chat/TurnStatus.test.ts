import { describe, expect, test } from "bun:test";
import { turnAnnouncement, type RunError, type TurnSignal } from "./TurnStatus";

const at = (phase: TurnSignal["phase"], attempt = 0, error: RunError | null = null): TurnSignal => ({ phase, attempt, error });

describe("turnAnnouncement", () => {
  test("the first look at a session says nothing — history isn't news", () => {
    expect(turnAnnouncement(null, at("idle"))).toEqual({});
    expect(turnAnnouncement(null, at("idle", 0, { key: "m1-err", text: "Model exploded" }))).toEqual({});
  });

  test("one sentence per state change, and silence while tokens stream", () => {
    const said: (string | undefined)[] = [];
    let prev = at("idle");
    for (const next of [at("working"), at("working"), at("working"), at("idle")]) {
      said.push(turnAnnouncement(prev, next).status);
      prev = next;
    }
    expect(said).toEqual(["Working", undefined, undefined, "Done"]);
  });

  test("a retry is named, with the attempt once there's more than one", () => {
    const start = turnAnnouncement(at("working"), at("retrying", 1));
    expect(start.status).toBe("Retrying");

    // The countdown ticks every second without the attempt changing: no repeats.
    expect(turnAnnouncement(at("retrying", 1), at("retrying", 1))).toEqual({});

    expect(turnAnnouncement(at("retrying", 1), at("retrying", 2)).status).toBe("Retrying, attempt 2");
    expect(turnAnnouncement(at("retrying", 2), at("working")).status).toBe("Working");
  });

  test("a failure interrupts instead of 'Done', and blanks the region for the next run", () => {
    const error: RunError = { key: "notice:n1", text: "Model unavailable" };
    const said = turnAnnouncement(at("working"), at("idle", 0, error));
    expect(said.alert).toEqual(error);
    // Blank, not "Working": an unchanged region can't announce the next run's "Working".
    expect(said.status).toBe("");
    expect(turnAnnouncement(at("idle", 0, error), at("working")).status).toBe("Working");
  });

  test("an error that arrives mid-run only interrupts; the state stays as it was", () => {
    const error: RunError = { key: "m2-err", text: "Rate limited" };
    const said = turnAnnouncement(at("working"), at("working", 0, error));
    expect(said.status).toBeUndefined();
    expect(said.alert).toEqual(error);
  });

  test("every state change speaks a string the region hasn't just said", () => {
    const boom: RunError = { key: "m1-err", text: "boom" };
    const said: (string | undefined)[] = [];
    let prev = at("idle");
    for (const next of [at("working"), at("idle", 0, boom), at("working"), at("idle")]) {
      const status = turnAnnouncement(prev, next).status;
      if (status !== undefined) said.push(status);
      prev = next;
    }
    expect(said).toEqual(["Working", "", "Working", "Done"]);
    said.forEach((line, i) => expect(line).not.toBe(said[i - 1]));
  });

  test("the same failure isn't read out twice", () => {
    const error: RunError = { key: "m2-err", text: "Rate limited" };
    expect(turnAnnouncement(at("idle", 0, error), at("idle", 0, error))).toEqual({});
    expect(turnAnnouncement(at("working", 0, error), at("working", 0, error))).toEqual({});
  });

  test("the same words from a later run are read again — the message, not the text, identifies them", () => {
    const first = turnAnnouncement(at("working"), at("idle", 0, { key: "m2-err", text: "Rate limited" }));
    const again = turnAnnouncement(at("working"), at("idle", 0, { key: "m9-err", text: "Rate limited" }));
    expect(first.alert?.text).toBe("Rate limited");
    expect(again.alert?.text).toBe("Rate limited");
    expect(again.alert?.key).toBe("m9-err");
  });

  test("after a failure the next run speaks normally again", () => {
    const failed = at("idle", 0, { key: "m2-err", text: "Rate limited" });
    expect(turnAnnouncement(failed, at("working")).status).toBe("Working");
    expect(turnAnnouncement(at("working"), at("idle")).status).toBe("Done");
    // An error clearing on its own — a fresh turn with nothing wrong — isn't news.
    expect(turnAnnouncement(failed, at("idle"))).toEqual({});
  });

  test("a long, multi-line error is shortened before it's spoken", () => {
    const noisy = `  boom \n at line 1\n\n   at line 2  `;
    expect(turnAnnouncement(at("working"), at("idle", 0, { key: "e", text: noisy })).alert?.text).toBe("boom at line 1 at line 2");

    const long = turnAnnouncement(at("working"), at("idle", 0, { key: "e", text: "x".repeat(900) })).alert?.text!;
    expect(long.length).toBe(300);
    expect(long.endsWith("…")).toBe(true);
  });
});
