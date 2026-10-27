/**
 * Translations of the English texts the core itself writes in the catalog (the mixed and all-variants
 * descriptions, the rounds-to-win option), keyed by the exact English sentence (see `tr()` in i18n.ts).
 * Each game ships the translations of its own catalog in `locales` of its game.json. Names of games and
 * variants are not translated. A test asserts coverage.
 */
import type { TranslatedLang } from '../i18n';

export const CATALOGS: Record<TranslatedLang, Record<string, string>> = {
  es: {
    'Rotates through every game and variant.': 'Rota por todos los juegos y variantes.',
    'Plays each variant in turn.': 'Juega cada variante por turnos.',
    'Rounds to win': 'Rondas para ganar',
    'Round wins a player needs to win the match.': 'Rondas que debe ganar un jugador para ganar la partida.',
  },
  fr: {
    'Rotates through every game and variant.': 'Passe en revue tous les jeux et toutes les variantes.',
    'Plays each variant in turn.': 'Joue chaque variante à tour de rôle.',
    'Rounds to win': 'Manches à gagner',
    'Round wins a player needs to win the match.': 'Nombre de manches qu’un joueur doit gagner pour remporter la partie.',
  },
  de: {
    'Rotates through every game and variant.': 'Wechselt durch alle Spiele und Varianten.',
    'Plays each variant in turn.': 'Spielt jede Variante nacheinander.',
    'Rounds to win': 'Runden zum Sieg',
    'Round wins a player needs to win the match.': 'Rundensiege, die ein Spieler braucht, um die Partie zu gewinnen.',
  },
  pt: {
    'Rotates through every game and variant.': 'Passa por todos os jogos e variantes.',
    'Plays each variant in turn.': 'Joga cada variante por turnos.',
    'Rounds to win': 'Rondas para ganhar',
    'Round wins a player needs to win the match.': 'Rondas que um jogador precisa de ganhar para vencer a partida.',
  },
  it: {
    'Rotates through every game and variant.': 'Passa in rassegna tutti i giochi e tutte le varianti.',
    'Plays each variant in turn.': 'Gioca ogni variante a turno.',
    'Rounds to win': 'Round da vincere',
    'Round wins a player needs to win the match.': 'Round che un giocatore deve vincere per aggiudicarsi la partita.',
  },
};
