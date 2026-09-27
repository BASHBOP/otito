import { EditableDate } from "@/components/inline-edit/EditableDate";

test("EditableDate renders an overnight range", () => {
  expect(EditableDate({ startTime: "22:00", endTime: "02:00" })).toBeTruthy();
});
