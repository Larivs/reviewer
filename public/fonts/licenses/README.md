# Polices embarquées

Les polices sont servies depuis le projet, jamais depuis un CDN : l'app doit
fonctionner sur un réseau fermé, et l'affichage ne doit pas dépendre d'un
tiers. Les redistribuer oblige à joindre leur licence — c'est l'objet de ce
dossier.

| Fichier | Famille | Licence |
|---|---|---|
| `archivo-latin*.woff2` | [Archivo](https://github.com/Omnibus-Type/Archivo) — Omnibus-Type | [OFL 1.1](archivo-OFL.txt) |
| `plexmono-*.woff2` | [IBM Plex Mono](https://github.com/IBM/plex) — IBM | [OFL 1.1](ibmplexmono-OFL.txt) |

Les fichiers `.woff2` sont des sous-ensembles latins extraits des versions
distribuées par Google Fonts. L'OFL autorise explicitement la modification et
la redistribution, y compris sous-ensemblée, tant que la licence suit et que
le nom réservé n'est pas usurpé — ces fichiers gardent donc leur nom de
famille d'origine.
