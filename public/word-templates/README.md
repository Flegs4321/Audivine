# Church Word template

Place your bulletin file here as:

**`church-template.docx`**

If this file exists, **Export to Word** on the review page fills it with service data. If the file is missing, the app uses the built-in layout (same as before).

Design your `.docx` in Word (colors, orange section bars, logo, footer) and insert the placeholders below where text should be filled in—**your layout stays exactly as you format it.**

## Placeholders (docxtemplater)

Use **double curly braces** in Word. Typical tags:

| Tag | Description |
|-----|-------------|
| `{{church_name}}` | Church name |
| `{{church_address}}` | Address line |
| `{{sermon_date}}` | e.g. April 6, 2026 |
| `{{bulletin_date_compact}}` | e.g. `2026.4.6` (good for a date box next to “Sunday Bulletin”) |
| `{{bulletin_title}}` | `Sunday Bulletin` |
| `{{message_title}}` | e.g. `MESSAGE: Jane Doe` or `MESSAGE` |
| `{{message_heading}}` | Same as `message_title` (duplicate for long orange-bar headings) |
| `{{spotify_footer}}` | `Past Sermons are Posted on SPOTIFY – Search for Channel:` |

### Lists (arrays)

Each line is one bullet string from the summary:

```
{#announcements}
➤ {.}
{/announcements}
```

```
{#upcoming_events}
➤ {.}
{/upcoming_events}
```
(`upcoming_events` is padded to **6** rows; empty rows are blank lines.)

```
{#sharing}
➤ {.}
{/sharing}
```

```
{#sermon}
➤ {.}
{/sermon}
```

### Spotify block (plain text)

| Tag | Default |
|-----|---------|
| `{{spotify_line1}}` | ON SPOTIFY... |
| `{{spotify_line2}}` | SEARCH FOR CHANNEL... |
| `{{spotify_channel}}` | CHAPEL807 |

### Full summary (optional)

`{{full_summary}}` — entire AI summary text as one block (useful for a simple single-column template).

## Tips

- Save as **.docx** (Word 2007+).
- After editing placeholders, test with **Export to Word** on a recording that has a generated member summary.
