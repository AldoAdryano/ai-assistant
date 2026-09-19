# Public `/stiker` access (bridge-only)

## Goal
Anyone can turn a photo/video into a sticker via `/stiker`. Owner keeps full Youyou. Guests get sticker-only (no Gemini/Worker chat).

## Rules
| Actor | Context | Trigger | Behavior |
|-------|---------|---------|----------|
| Guest / owner | DM or group | Media caption `/stiker` OR reply-to media + `/stiker` | Sticker only; no text reply; no Worker |
| Owner | DM | Normal chat | Full Youyou → Worker (unchanged) |
| Owner | Group | `@` bot JID OR reply to bot message | Full Youyou → Worker |
| Anyone else | Otherwise | — | Silent ignore |

## Details
- Command: case-insensitive `/stiker` (word boundary); no on-sticker caption for public path.
- Wrong usage (no media): silent.
- Light mode / convert fail (guest): silent + log; owner may still get existing error texts on full path.
- Alarms: owner DM only.
- Architecture: bridge-only for public stickers (Approach 1).

## Non-goals
- Public captions, rate limits, Worker involvement for guests.
