{
  "id": "__ID__",
  "name": "__NAME__",
  "version": "0.1.0",
  "author": "Your Name",
  "license": "MIT",
  "description": "A short description of __NAME__.",
  "catalog": {
    "id": "__ID__",
    "name": "__NAME__",
    "description": "Grab the most orbs before time runs out.",
    "action": "act",
    "guide": {
      "objective": { "en": "Grab the most orbs before time runs out.", "es": "Coge más orbes que nadie antes de que acabe el tiempo.", "fr": "Ramasse le plus d'orbes avant la fin du temps.", "de": "Schnapp dir die meisten Kugeln, bevor die Zeit abläuft.", "pt": "Apanha mais orbes do que os outros antes de o tempo acabar.", "it": "Prendi più sfere possibile prima che scada il tempo." },
      "rules": [
        { "en": "Move to collect orbs; each one is a point.", "es": "Muévete para recoger orbes; cada uno es un punto.", "fr": "Déplace-toi pour ramasser des orbes ; chacun vaut un point.", "de": "Bewege dich, um Kugeln einzusammeln; jede ist ein Punkt.", "pt": "Move-te para apanhar orbes; cada um vale um ponto.", "it": "Muoviti per raccogliere le sfere; ognuna vale un punto." }
      ]
    },
    "options": [
      { "id": "timeLimit", "label": "Round length", "description": "Seconds the round lasts.", "type": "number", "default": 30, "min": 10, "max": 120, "step": 5, "unit": "s" },
      { "id": "orbs", "label": "Orbs", "description": "How many orbs are on the field at once.", "type": "number", "default": 5, "min": 1, "max": 20 }
    ],
    "variants": []
  },
  "locales": {
    "es": {
      "Grab the most orbs before time runs out.": "Coge más orbes que nadie antes de que acabe el tiempo.",
      "Round length": "Duración de la ronda",
      "Seconds the round lasts.": "Segundos que dura la ronda.",
      "Orbs": "Orbes",
      "How many orbs are on the field at once.": "Cuántos orbes hay a la vez en el campo."
    },
    "fr": {
      "Grab the most orbs before time runs out.": "Ramasse le plus d'orbes avant la fin du temps.",
      "Round length": "Durée de la manche",
      "Seconds the round lasts.": "Secondes que dure la manche.",
      "Orbs": "Orbes",
      "How many orbs are on the field at once.": "Combien d'orbes sont sur le terrain en même temps."
    },
    "de": {
      "Grab the most orbs before time runs out.": "Schnapp dir die meisten Kugeln, bevor die Zeit abläuft.",
      "Round length": "Rundendauer",
      "Seconds the round lasts.": "Sekunden, die die Runde dauert.",
      "Orbs": "Kugeln",
      "How many orbs are on the field at once.": "Wie viele Kugeln gleichzeitig auf dem Feld sind."
    },
    "pt": {
      "Grab the most orbs before time runs out.": "Apanha mais orbes do que os outros antes de o tempo acabar.",
      "Round length": "Duração da ronda",
      "Seconds the round lasts.": "Segundos que a ronda dura.",
      "Orbs": "Orbes",
      "How many orbs are on the field at once.": "Quantos orbes há ao mesmo tempo no campo."
    },
    "it": {
      "Grab the most orbs before time runs out.": "Prendi più sfere possibile prima che scada il tempo.",
      "Round length": "Durata del round",
      "Seconds the round lasts.": "Secondi di durata del round.",
      "Orbs": "Sfere",
      "How many orbs are on the field at once.": "Quante sfere ci sono in campo contemporaneamente."
    }
  }
}
