import { defineTool } from './define.js';

export const getCurrentTime = defineTool<{ timezone: string }>({
  name: 'get_current_time',
  description:
    "Get the current date and time. Call this whenever the answer depends on today's date or the current time - you don't otherwise know it.",
  properties: {
    timezone: {
      type: 'string',
      description:
        'IANA time zone such as "Asia/Kathmandu" or "UTC". Use "local" for the machine\'s own time zone.',
    },
  },
  async run({ timezone }) {
    const now = new Date();
    const timeZone = timezone && timezone !== 'local' ? timezone : undefined;
    let formatted: string;
    try {
      formatted = now.toLocaleString('en-US', { timeZone, dateStyle: 'full', timeStyle: 'long' });
    } catch {
      throw new Error(`Unknown time zone "${timezone}". Use an IANA name like "Europe/London".`);
    }
    return {
      iso_utc: now.toISOString(),
      formatted,
      timezone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
});
