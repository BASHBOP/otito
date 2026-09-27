import { combineDateAndTime } from "@/utils/create-event";

test("combineDateAndTime keeps the date", () => {
  expect(combineDateAndTime("2026-09-27", "10:00", "UTC").toISOString()).toContain("2026-09-27");
});
