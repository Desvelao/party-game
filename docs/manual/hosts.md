# Hosting a room

The player who creates a room is its host. The host chooses what is played and manages the room.

## Choose what to play

On **New room** pick one of:

| Choice | What happens |
|---|---|
| A game and one variant | the same variant every round |
| A game and *All variants (rotate)* | the variants of that game in order |
| *Mixed - all games* | a different game each round |
| A custom playlist | exactly the rounds you picked, up to 10 |

### Filter games by tag

Every game carries tags such as **Last standing**, **Race**, **Points**, **Turn-based**, **Ball game**, **Vehicles** and
**Hazards**. Above the game list, tap one or more tags to show only the games (and variants) that have all of them.
Tap a selected tag again, or **Clear**, to show everything. If nothing matches, you see "No game has all the selected
tags." The tags of the game you picked are shown under its description. The same tag buttons are in the custom
playlist screen, above the list where you add rounds.

Every game has **Advanced options** (time limit, health, speed and more) that you can adjust; **Reset to defaults**
puts them back. The operator may have changed the defaults. The **Rounds to win** option sets how many round wins a player
needs to win the match.

### Custom playlist

1. Choose a playlist in the game selection.
2. Add rounds: for each, pick the game and variant and, if you like, its options.
3. Save it to your profile (**Save playlist**) if you will reuse it, then **Create room**.

Presets you saved earlier, and playlists published by the operator, can be loaded from the same screen.

## Room controls

In the lobby you see **Room controls** and buttons on every other player:

| Control | Use it to |
|---|---|
| **Make host** | hand the room to another connected player |
| **Make spectator** (👁 button on a player) / **Make player** (🎮 button on a watcher) | move someone between the player seats and the spectators; also works on yourself, see below |
| **Reset name** | replace an unwanted name with a neutral one |
| **Kick** (tap again to **Confirm kick**) | remove a player or spectator |
| **Lock room** / **Unlock room** | stop or allow new players ("Room locked: no new players") |
| **Max players** (**Fewer players** / **More players**) | cap the room (never below how many are in already) |
| **Allow joining between rounds** / **Stop joining between rounds** | let spectators tap **Take a seat** on the results screen between rounds; the next round includes them |
| **Catch-up score** (**Fewer players** / **More players** buttons, steps of 10%) | shown once joining between rounds is on: a newcomer starts with this percentage of the lowest score at the table (0% starts from zero) |
| Password **Set** / **Change** / **Remove** | protect the room; the host's copy-link buttons include it |
| **Fill room with bots** / **Stop filling with bots** | keep every free seat taken by bots; a player who joins takes a bot's seat (only if the operator turned bots on) |
| **Bot level** | pick how good the bots are: Easy, Normal, Hard, Expert, Semigod or Random |
| **Add bot** (with the level next to it) | reserve one seat for a bot of that level; its **Remove bot** button (✕) takes it away |
| **Play in teams** | team play for games that support it |
| **Change game** and **Use this game** | switch game, variant or playlist before the match starts |
| **Game options** and **Use this game** | change the **Advanced options** of the game you picked (shown only when it has some) without changing the game; the screen starts with the values the room is using now |

Changing the game or its options makes everyone tap ready again.

### Watching your own room

Tap **Watch instead** next to **Start game** to give up your seat and watch, for example when you run the room from a big screen. You stay the host: you can still start the game, kick, change the settings and choose what comes next, and the room stays open while you watch. Tap **Play too** to take a seat again. You can switch in the lobby and on the results screen, never during a round. A player who becomes a spectator loses their score; if you take a seat later you start like any newcomer.

To stop what is running and bring everyone (and the TV) back to the lobby, open the menu, choose **Everyone back to the lobby** and tap it again to confirm. The round is cut short and no result is saved. Only the host sees this button, including the phone host in console mode.

On a Raspberry Pi TV in console mode, the host is a phone: it pairs with the PIN on the TV, then uses **Control the room** and **Play too**. See [the party box guide](../party-box.md).

On a screen that only watches (the TV or projector link), the lobby shows the room's QR code by default: players point their phone camera at it to join. On a phone, choose **Show QR** to see it and **Hide QR** to close it.

Bots appear in the player list with a 🤖 tag and their level, and play and ready up by themselves. They only join while the room is in the lobby, and only for games that have a bot player: every game that comes with the server has one; a game you installed may not, and then bots sit its rounds out. In a team game a bot never aims at its own teammates on purpose, but blasts and area hits catch everyone, as they do for people. The room closes when the last person leaves.

## Starting a match

1. Wait for the **Start game** button (everyone ready). The button shows **Waiting for: <names>** while someone is not.
2. If someone is away from their phone choose **Start anyway**: they are counted as ready and play.
3. After a match, choose **Play again** (same settings) or **Change game** (back to the lobby). Both are decided
   by a vote of the players.

## If the host leaves

The room goes on: the host role passes to the next connected player, and everyone sees "*Name* is now the host".
If the host only lost their connection and comes back within about a minute, they get the role back.
A player the host kicked cannot come back into that room with the same profile.

If the host stays away from their phone (outside a running round) while another player keeps using the room,
that player becomes the host after about 90 seconds. The operator can change or turn off this wait
(`game.hostIdleSeconds`, see [Configuration](configuration.md)).

As host, **Leave room** asks for a second tap ("Tap again to leave") while other players are in the room, because
leaving hands the room over.

## Closing

The room is closed when nobody is connected any more and nobody can return in time, or when it sits idle in the
lobby for too long (players are warned shortly before; see [Configuration](configuration.md)).
