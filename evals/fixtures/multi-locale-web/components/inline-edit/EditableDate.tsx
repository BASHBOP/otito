import { formatEventDate } from "@/lib/datetime/format";

interface EditableDateProps {
  startTime: string;
  endTime: string;
}

export function EditableDate({ startTime, endTime }: EditableDateProps) {
  const overnight = endTime < startTime;
  return overnight ? formatEventDate(endTime) : formatEventDate(startTime);
}
