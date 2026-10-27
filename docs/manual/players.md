# Playing

Everything a player does: create or join a room, share the code, change settings and play a match. You need only a
browser; phones work best as controllers.

## Open the game

Open the address you were given, for example `http://192.168.1.20:8080/`. Type a **nickname** in the field
(up to 16 characters). It is remembered next time.

To keep the game on your home screen like an app, see [Install as an app](install-app.md).

Tick **Play as guest (nothing saved)** if you do not want a profile: no statistics, character looks or presets are kept on
the server. See [Your profile](profiles.md).

## Create a room

1. Enter a nickname and choose **Create room**.
2. On the **New room** screen pick a **Game** and a **Variant**. Other choices are *All variants (rotate)* and
   *Mixed - all games*. See [Games](games.md) and [Hosting a room](hosts.md) for playlists and options.
3. Optionally open **Advanced options**, type a **Room password**, or tick **List this room publicly** so anyone can find it under **Public rooms** on the start screen (rooms with a password are not shown there).
4. Choose **Create room**. You are the host and see the lobby with the 4-letter room code.

Public rooms that are still open in the lobby appear under **Public rooms** on the start screen: tap one to join it.
If the server restarts while your room is still in the lobby, the room comes back with the same code and settings
(players join again; rooms with a password are not kept).

## Share the room code

In the lobby the code is shown big at the top, with the full link under it.

| Button | What it does |
|---|---|
| **Copy invite link** | copies a link that opens the game straight on this room |
| **Copy watch link** | copies a link for someone who only wants to watch |
| **Share invite** | opens your phone's share sheet (only shown when your device supports it) |
| **Show QR** / **Hide QR** | shows a QR code of the invite link; friends scan it with their camera |

A password-protected room asks every newcomer for the password.

## Join a room

There are three ways:

- **With a code**: enter your nickname, type the 4-letter code under *or join with a code* and choose **Join room**.
  Press Enter on the keyboard to move from the nickname to the code and to join. You can also paste an invite
  link into the code field: only the code is kept. **Join room** becomes the main button once the code is complete.
- **With a link or QR**: open the invite link. Check your nickname and join; Enter on the keyboard moves from the
  nickname to the password (if the room has one) and then joins. After a wrong password the password you typed is still there.
- **Rejoin**: if you left a room that is still open, the menu shows **Rejoin ABCD** above **Create room**. If the
  server does not share its room list, the button is shown anyway and tells you if the room is gone.
- If you are signed in, you can only sit once in a room: opening the room on a second device or tab takes your
  seat over, and without a saved seat you see "You are already in this room on another device or tab".

If the match has already started you automatically become a spectator ("Watching - you can join as a player in
the next lobby"). When the room returns to the lobby, choose **Join as player**. If the room is full the button
says **Room full - watching**. A locked room refuses new players.

You can also give up your seat yourself: in the lobby and on the results screen, tap **Watch instead** to become a spectator (your score is not kept), and **Join as player** to sit down again. The host can move any user between playing and watching, too.

If the host allowed joining between rounds, you can also tap **Take a seat** on the results screen between
rounds. You join the next round and start with a share of the lowest score at the table, so you are not far behind.

## In the lobby

1. Check the player list. The host is marked **HOST**.
2. Tap **I'm ready!** (tap again for **Not ready**).
3. The host's button reads **Waiting for: <names>** until everyone is ready, then **Start game**. The host can also
   choose **Start anyway** to start without the players who are not ready.
4. A **Game guide** at the bottom explains the objective and controls of the chosen game.

## Controls

| Device | Move | Action |
|---|---|---|
| Computer keyboard | `W A S D` or the arrow keys | `Space` or `J` (second action `E` or `L`) |
| Touch screen | on-screen joystick or cross | on-screen action button |

You can change every key and the on-screen layout in **Settings** (below). Each game shows the name of its action
button (DASH, BOOST, GRAB, CHARGE, FIRE, ACT, KICK, MINE).

## Settings

Open them from the lobby or the main menu with **Settings**. During a match press `Esc` (or the menu button) and
choose settings from there.

| Section | What you can change |
|---|---|
| Sound | sound on/off and the volume of Master, Effects and Music |
| Language | English, Español, Français, Deutsch, Português or Italiano; saved in your profile |
| Connection | shows the quality of your connection (good, fair, weak, poor) |
| Controls | rebind keyboard keys (two per action), reset to defaults |
| Accessibility | colour-blind friendly colours, a number and shape on every player, screen shake level |
| On-screen controls | show always, never or only on touch screens; joystick or cross (per game too); **Control size**, **Control opacity**, which side the movement control is on (**Movement control side**), **Vibrate on hits and eliminations**, and **Floating joystick (appears where you touch)**, which puts the stick under your thumb wherever you touch the lower corner |

Keys are saved in your profile; as a guest they are kept for this tab only.

## During a match

- While a round runs, your phone's screen stays on, so it does not dim or lock. Phones that support it also vibrate
  when you are hit or eliminated; turn that off with **Vibrate on hits and eliminations** in **Settings**.
- A round ends, results are shown, and the next game starts by itself a few seconds later (the host can skip
  the wait with **Next game**). A match ends when someone has won enough rounds.
- At the end you see the final ranking and the **MVP** (the player who won the most rounds). Open **Round by round** to see who placed where in every round.
- Then the host chooses **Play again** or **Change game**.
- Press `Esc` or the menu button for **Resume**, **Restart round (vote)**, **Restart match (vote)** and
  **Leave room**. A restart needs the majority of the connected players to agree within 15 seconds.
- The results screen shows which game of the playlist this is and how many round wins decide it.

## If your connection drops

The screen shows **Connection lost - reconnecting...** with the attempt number. Your seat is held for about a
minute (the operator can change this), and you return with your score. Choose **Leave** on that banner if you
want to stop waiting. If you only locked your phone or switched apps for a moment, the game checks the
connection when you come back and says **Welcome back!**

If the game round is already running when you return, you usually watch that round and join in again at the next one. Some games let you jump back into the round you left.

A screen that is only watching (for example a TV on a watch link) reconnects the same way and goes back to the
room by itself.

If you were away longer than that, you see "Your seat was released - you joined again as a new player" (or, in a
running match, you are placed as a spectator).

If the server itself restarted, rooms are gone: create or join a new one.

## Leave

Choose **Leave room** in the lobby or the menu. In the lobby your seat is freed at once. The in-game menu, and the
host's lobby when other players are present, ask you to tap a second time ("Tap again to leave"); if you do not, the
button goes back to normal after a few seconds.
