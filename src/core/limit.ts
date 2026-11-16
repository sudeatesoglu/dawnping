/**
 * The time a usage limit resets, from claude's message, if it is a time of
 * today: "resets 4pm", "resets 3:30pm", "resets 16:00". A message with a
 * date ("resets Nov 20, 4pm") or without a time gives undefined. Claude
 * Code prints the time in the user's time zone.
 */
export function limitResetToday(message: string): number | undefined {
  const match = /\bresets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(message);
  if (!match) return undefined;
  const [, hourText, minuteText, meridiem] = match;
  // A bare number could be a day of the month ("resets 20 Nov").
  if (meridiem === undefined && minuteText === undefined) return undefined;
  let hours = Number(hourText);
  const minutes = Number(minuteText ?? 0);
  if (meridiem !== undefined) {
    if (hours < 1 || hours > 12) return undefined;
    hours = (hours % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}
