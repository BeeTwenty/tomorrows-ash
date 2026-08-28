---
title: Getting started
summary: From nothing to standing in the world — account, client, realmlist, first character.
order: 2
---

Nothing here needs a modified client, a launcher, or an addon. If you have a working World of
Warcraft 3.3.5a install, you are four steps away.

## 1. You need a 3.3.5a client

Build **12340**, the last Wrath of the Lich King patch. You supply it yourself. Tomorrow's Ash
distributes no Blizzard files — not the client, not the data, not a "repack". That is not caution,
it is the line the project does not cross.

If your client shows a different build number in the bottom-left corner of the login screen, it will
not connect.

## 2. Make an account

[Create one here](/register). One account covers the website and the game client — they are the same
credentials, stored on the same login server.

Two limits worth knowing before you pick:

- Account names and passwords are capped at **16 characters**. That is the game client's limit, not
  ours; anything longer is silently truncated by the client and then fails to match.
- Both are case-insensitive. `Emberlyn` and `EMBERLYN` are the same account.

## 3. Point the client at Ashmorrow

Find `realmlist.wtf` in your client folder. It usually lives at `Data\enUS\realmlist.wtf`, where
`enUS` is whatever locale you installed. Replace everything in it with one line:

```
set realmlist ashmorrow.example
```

The [connection page](/play) always shows the current address — use that rather than copying the
example above.

Some clients read `WTF\Config.wtf` instead. If the first one does not take effect, edit both, then
launch `Wow.exe` **directly**. The Blizzard launcher will try to patch your client to a newer
version and break it.

## 4. Make a character

At creation you pick a race and a chassis. The chassis is the thing the client calls a class — on
Ashmorrow it decides your health, your armour and your resource, and nothing about what you can
learn. Pick the body you want to live in, not the abilities you want; those come later and they are
all available.

## What to do first

Level as you always have. The classless system layers on top of the ordinary game rather than
replacing it, so quests, dungeons and professions all work the way you remember.

When ability trees go live, you will spend points through a broker NPC rather than the talent
window. The 3.3.5a talent frame is drawn by the client from its own local files and is locked to
whatever class it thinks you are — so we cannot use it without shipping a client patch, and we are
not going to. A gossip menu is plainer. It also works for everyone, on day one, with no download.

## If something goes wrong

| Symptom | Cause |
|---|---|
| Launcher updates the client | Run `Wow.exe` directly |
| "Unable to connect" | Login server down, or `realmlist.wtf` not saved — check [realm status](/status) |
| Logs in, realm greyed out | World server down or restarting |
| Password rejected but you are sure | Longer than 16 characters somewhere |
| Realm missing from the list | Wrong client build, or the realm is genuinely dark |

The [realm status page](/status) probes both servers directly, so it can tell you whether the problem
is on your side or ours.
