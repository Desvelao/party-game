# Your profile

A profile keeps your name, colour, character, language, statistics, keys and saved presets. There are no accounts
or passwords: the browser creates a secret **profile code** the first time you play, and that code is how you get
your profile back.

## What a profile keeps

| | |
|---|---|
| Name and preferred colour | used when you join (the colour only if it is free in the room) |
| Characters | one look for every character the installed games use (for example Blob: body, eyes, mouth, hair, hair colour, glasses and hat), and which one is your avatar |
| Statistics | matches, wins, win rate, points, best match score and results per minigame |
| Recent matches | your last matches (10 by default; the operator can change it): place, score and how each round went, shown in the **Recent matches** tab |
| Settings | language, keyboard keys, on-screen control layout, accessibility and sound choices |
| Presets | saved variants and playlists to reuse when creating a room |

## Open and edit it

1. Choose **My profile** in the main menu (or **Profile** in the top bar).
2. Use the tabs **Info**, **Stats**, **Recent matches**, **Customize** and **Presets**. Tap a match in **Recent matches** to see your place in every round. Guests have no profile, so they keep no history.
3. In **Customize** change the **Name**, **Preferred color** and **Character**, then **Save**. See
   [Customize your characters](#customize-your-characters).
4. **Presets** lists your saved variants and playlists; you can rename or remove them.

## Customize your characters

Each game draws you with a character model, and several games can share one (for example, most games draw a Blob).
Which models there are depends on the games and plugins the server has installed. You keep one look per model.

1. Open **Customize**.
2. When there is more than one model, tap its name under **Character** to pick the one to change.
3. Change each part with the **‹** and **›** buttons, or tap **Randomize** for a random look or **Reset** to go back
   to that model's starting look.
4. Tap **Use as my avatar** to show this model next to your name outside the games (for example on the
   leaderboard). Without a choice, the first model is used.
5. Tap **Save**. Every game that uses that model now draws you with this look.

If **Customize** says "The games installed here have no character to customize.", no installed game draws
characters; your name and colour still apply.

You save a variant from the room-creation screen with **Save as variant** and load it again with **Saved variants...**; a playlist is saved with **Save playlist** in the playlist builder.

## Your profile code

In **Info** you see the **Profile code**. Treat it like a password: whoever has it can use your profile.

- **Copy code** puts it on the clipboard.
- Keep it somewhere safe. If you lose it and clear your browser data, the profile cannot be recovered.

## Continue on another device

Under **Continue on another device** choose one of:

1. **Copy recovery link**: copies a link that never expires. Open it on the new device. Keep this link private.
2. **Copy code**: on the new device choose **Use another code** and paste the profile code.
3. **Show QR / transfer code**: shows a QR and an 8-letter **Transfer code**. It works once and for about
   5 minutes. On the new device scan the QR with the camera (it opens the game and adopts your profile), or
   open the game, choose **Use another code** and type the transfer code. This button is there only when the
   server runs the transfer plugin (it does by default); if you do not see it, use the link or the code.

When it works the game says "Profile code applied" and lands on your profile with your name, look and stats. The
old device keeps working too.

To use a different profile on a device, choose **Use another code** and paste that profile's code, recovery link
or transfer code.

## Guest mode

Tick **Play as guest (nothing saved)** before you join. Nothing is stored on the server, your results do not count
and your keys last for this browser tab only.

## Your progress

When the server runs the progression plugin (it does by default), the **Info** tab ends with a **Progress** block:

1. **Level** and your XP, with a bar that fills until the next level. You earn XP for every round (more for a better place), for every
   finished match, and extra for winning one.
2. **Win streak**: matches won in a row, and your best. Losing a match against other players resets it; playing alone does not.
3. **Achievements**: stars for what you have done, like **First win**, **On fire** (3 wins in a row) or **Explorer** (5 different games).
   Greyed-out ones are still to earn.
4. **Best places**: your best place in each game you have played.

Only matches played while the plugin is on count. Guests do not earn progress. An operator can reset your progress.

## Other things to know

- Your statistics feed the public leaderboard (the **Top** page, when the server runs the leaderboard plugin, which it does by default). An operator can hide a profile from
  it or remove a profile.
- Profiles live on the server that hosts the game. A different server has its own profiles.
