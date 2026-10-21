<h1 align="center">Discord Quest Completer</h1>

<p align="center">
  <img src="public/logo.png" alt="" width="96" height="96" />
</p>

<p align="center">
  Validez vos <strong>Quêtes Discord</strong> qui demandent de « jouer » à un jeu, sans l'installer.<br />
  Application de bureau Windows : <strong>Tauri 2</strong> · <strong>React 19</strong> · <strong>Tailwind CSS 4</strong> · <strong>Rust</strong>.
</p>

> [!WARNING]
> Cet outil est destiné à un usage personnel et éducatif. Faire croire à Discord qu'un jeu est lancé peut
> contrevenir à ses conditions d'utilisation et exposer votre compte à des sanctions. Les auteurs déclinent
> toute responsabilité. Discord est une marque de Discord Inc., avec laquelle ce projet n'a aucun lien.

Réécriture complète du projet [markterence/discord-quest-completer](https://github.com/markterence/discord-quest-completer)
(licence MIT), avec une interface repensée, un backend plus solide et de nouvelles fonctionnalités.

## Fonctionnalités

- **Recherche instantanée** parmi plus de 10 000 jeux détectables (`Ctrl + K`), tolérante aux fautes de frappe,
  aux accents et aux symboles ™ ® ©.
- **Lancement en un clic** : l'application crée un minuscule exécutable factice (≈ 220 Ko) au nom attendu par
  Discord et le démarre.
- **Quêtes Discord dans l'application** (optionnel, nécessite le token du compte, voir
  [Quêtes Discord](#quêtes-discord-optionnel)) : vos quêtes, et le jeu demandé à ajouter ou lancer en un clic, avec la
  durée exacte de la quête.
- **Diagnostic de détection** : pastille « Discord détecté », et, pour chaque jeu lancé, un panneau qui vérifie
  Discord, le processus et la fenêtre, puis **confirme dans le journal local de Discord** que le jeu a bien été vu
  (voir [Détection par Discord](#détection-par-discord)).
- **Minuteur de quête qui démarre à la détection** : il attend que Discord ait réellement vu le jeu, avec anneau de
  progression, **notification système** à la fin et **arrêt automatique** optionnel (durée réglable, 15 min par défaut).
- **Plusieurs jeux en parallèle**, lancés d'un clic depuis la liste (ou tous à la fois), arrêtés individuellement ou
  d'un seul coup (fenêtre ou icône de la barre d'état).
- **Bibliothèque persistante** avec filtre, temps simulé et dernier lancement par jeu, **export / import**
  (presse-papiers) pour la retrouver ailleurs.
- **Démarrage avec Windows**, réduit dans la barre d'état ; fenêtre des faux jeux visible, réduite ou masquée.
- **Liste des jeux toujours disponible** : API de Discord → cache disque (24 h) → liste intégrée à l'application.
- **Rich Presence expérimentale** (type d'activité, détails, état, « démarré il y a… »).
- **Journal d'activité**, thème clair / sombre / système, interface **française et anglaise**.
- **Nettoyage** des exécutables factices en un clic, réduction dans la barre d'état à la fermeture.

## Ce qui change par rapport à l'original

| | Original | Cette version |
| --- | --- | --- |
| Interface | Vue, thème basique | React + Tailwind, design system, clair/sombre, FR/EN, raccourcis clavier |
| Identifiants de jeux | `Number(id)` : les IDs Discord (> 2⁵³) sont **corrompus** | Toujours des `String`, validés (`^\d{1,20}$`) |
| Arrêt d'un jeu | `taskkill /IM` : tue **tous** les processus du même nom, y compris le vrai jeu | Chaque session possède son processus, seul lui est arrêté |
| Processus fermé de l'extérieur | Le bouton « Stop » reste bloqué | Détecté en moins d'une seconde |
| Crash de l'application | Les faux jeux restent actifs | Job Object Windows : ils sont tués avec elle |
| Dossier des exécutables | À côté de l'exe (échoue dans `Program Files`) | `%LOCALAPPDATA%`, toujours inscriptible |
| Noms d'exécutables | Filtre de caractères uniquement | Validation par segment (`..`, chemins absolus, noms réservés Windows, MAX_PATH) |
| Persistance | Aucune | Bibliothèque et réglages, écriture atomique |
| Erreurs | `unwrap()` partout (panique du backend) | `Result` typés, jamais de panique en fonctionnement normal |
| Runner | C++ `no_std` + hacks de linkage | Rust pur (`windows-sys`), CRT statique, embarqué dans l'exécutable |
| Retour visuel | Aucun : impossible de savoir si Discord voit le jeu | État de Discord, vérification de la détection |
| Tests | Aucun | 118 tests Rust + 91 tests frontend |

## Installation

Téléchargez l'installateur (`…_x64-setup.exe`) depuis les *Releases*. L'installation se fait pour l'utilisateur
courant, sans droits administrateur. WebView2 est requis (préinstallé sous Windows 11).

Aucune donnée n'est écrite à côté de l'exécutable : tout est dans `%LOCALAPPDATA%\dev.questcompleter.app\`
(`settings.json`, `library.json`, cache de la liste et dossier `games\`). Pour désinstaller complètement,
supprimez ce dossier après avoir désinstallé l'application.

## Utilisation

1. Appuyez sur `Ctrl + K` et cherchez le jeu demandé par votre quête.
2. `Entrée` l'ajoute à votre bibliothèque.
3. Cliquez sur **Lancer**. Discord affiche « Joue à … » après quelques secondes.
4. Laissez tourner jusqu'à la fin du minuteur, puis vérifiez la progression dans Discord.

Raccourcis : `Ctrl + K` recherche · `⇧ Entrée` dans la recherche ajoute **et lance** le jeu · `Ctrl + 1…5` change
de page.

> [!NOTE]
> Le minuteur est indicatif : c'est Discord qui valide la quête.

## Quêtes Discord (optionnel)

La page **Quêtes** affiche vos quêtes Discord et propose, pour celles qui demandent de jouer sur PC, d'**ajouter le jeu à
la bibliothèque** ou de **le lancer** avec la durée demandée par la quête.

**Pourquoi un token ?** Discord ne publie pas la liste des quêtes : `GET /api/v10/quests/@me` renvoie `401 Unauthorized`
sans les identifiants du compte. Il n'existe pas d'autre moyen officiel de lire cette liste ; c'est pourquoi la fonction
est **désactivée par défaut** et n'apparaît qu'après une explication complète et une confirmation explicite.

Ce que fait l'application avec ce token :

- **une seule requête, en lecture**, vers `discord.com` (HTTPS uniquement, redirections désactivées) ;
- le token est vérifié auprès de Discord **avant** d'être enregistré, puis conservé dans le **gestionnaire d'identifiants
  de Windows** : jamais dans un fichier de l'application, jamais dans le journal, jamais renvoyé à l'interface ;
- il est effacé d'un clic (« Oublier mon token »), et automatiquement si Discord le refuse ;
- l'application **ne cherche jamais** le token toute seule : c'est l'utilisateur qui le fournit, ou personne ;
- elle **n'accepte, ne démarre ni ne valide jamais** une quête avec le compte : les quêtes restent validées par les faux
  jeux, comme avant.

> [!WARNING]
> Un token donne un accès complet au compte, et l'utiliser en dehors du client officiel est contraire aux conditions
> d'utilisation de Discord, même pour une simple lecture : cela peut conduire à des sanctions. Ne le communiquez à
> personne et méfiez-vous de toute application ou personne qui vous le demande. Si vous ne savez pas ce qu'est un
> token, n'activez pas cette fonction. Le code concerné est dans `src-tauri/src/quests/`.

**Trouver son token** : la fenêtre de saisie contient un **tutoriel pas à pas** (méthode par l'onglet « Réseau » des
outils de développement du navigateur : une simple lecture d'un en-tête, sans code à exécuter) et met en garde contre
l'arnaque classique, qui consiste à coller du code dans la console.

Le format de la réponse de Discord n'étant pas documenté, l'analyse est tolérante ; un bouton **« Copier la réponse
brute »** (qui ne contient pas le token) permet de diagnostiquer un affichage incomplet.

## Détection par Discord

### Le minuteur ne démarre qu'à la détection

Par défaut, le minuteur de quête **attend que Discord ait vu le jeu** : il n'avance pas tant que Discord ne l'a pas
repéré, et indique « En attente de Discord ». La détection est lue dans le journal local de Discord
(`%APPDATA%\discord\logs\renderer_js.log`), **en lecture seule, uniquement pour retrouver les jeux lancés par
l'application** ; rien n'est conservé ni envoyé. Deux sources de preuve existent :

- le jeu devient le **jeu principal** de Discord : preuve immédiate (quelques secondes) ;
- sinon (un autre jeu est déjà affiché en premier, par exemple Roblox), Discord ne nomme les autres jeux détectés que
  lors de son **battement toutes les 5 minutes** : le chrono démarre alors à cette confirmation, **jamais avant**,
  quitte à partir un peu en retard. C'est volontairement prudent.

Si le journal de Discord est introuvable, la détection est invérifiable : le minuteur démarre alors dès le lancement,
avec un avertissement. L'option se désactive dans les réglages (« Démarrer le minuteur à la détection par Discord »).

### Comment ça se passe

Discord analyse les processus **toutes les 15 à 60 secondes** : après un lancement, comptez en général une quarantaine
de secondes avant de voir « Joue à … ». Le panneau de détection de chaque jeu lancé affiche ce que le journal de Discord a révélé (ou, si vous avez désactivé
l'attente de détection, un bouton **« Vérifier dans le journal de Discord »** à déclencher vous-même).

Si Discord ne voit toujours rien :

- utilisez **l'application de bureau officielle** (Discord, PTB ou Canary) : ni un navigateur, ni Vesktop / Legcord
  ne détectent les jeux ;
- activez le partage de l'activité détectée dans Discord (*Paramètres → Confidentialité des activités*) ;
- Discord n'affiche qu'**un seul jeu principal** à la fois : arrêtez les autres pour tester celui-ci ;
- essayez un autre exécutable de la liste, ou réglez la fenêtre des faux jeux sur **Visible**.

## Comment ça marche

Discord reconnaît un jeu « vérifié » en observant les processus de la machine : si un processus porte le nom
d'exécutable enregistré (par exemple `bin/win64/game.exe`), il le considère comme lancé. L'application :

1. crée `games\<id du jeu>\bin\win64\game.exe`, une copie du *runner* ;
2. le démarre avec le nom du jeu en titre de fenêtre ;
3. suit le processus (pas seulement son nom) jusqu'à ce que vous l'arrêtiez ou qu'il se termine.

Le *runner* est une petite fenêtre Win32 avec une icône de zone de notification. Il est compilé par le script
de build de `src-tauri` puis **embarqué** dans l'exécutable principal : il n'y a rien à copier à la main.

## Architecture

```
.
├─ src/                     Frontend React
│  ├─ components/ui/          Primitives (Button, Modal, Switch, Field…)
│  ├─ features/               games · catalog · sessions · presence · logs · settings · shell
│  ├─ lib/                    ipc typé, événements, i18n, recherche, formats
│  ├─ dev/mock-backend.ts     Faux backend pour le développement dans un navigateur
│  └─ styles/                 Design tokens (oklch), thèmes, polices
├─ src-tauri/               Backend Rust (Tauri)
│  └─ src/
│     ├─ games/               catalogue Discord, bibliothèque, export/import, validation des exécutables
│     ├─ process/             sessions, Job Object, runner embarqué, liste des processus
│     ├─ discord.rs           état du client Discord, vérification de la détection
│     ├─ quests/              quêtes Discord (token, requête en lecture seule, analyse)
│     ├─ commands.rs          surface IPC exposée au frontend
│     └─ lifecycle.rs         fenêtre, barre d'état, surveillance des sessions
├─ runner/                  Faux processus de jeu (crate séparée, ≈ 220 Ko)
└─ scripts/                 Mise à jour de la liste des jeux intégrée
```

État : les données qui vivent dans Rust (catalogue, bibliothèque, réglages) sont gérées par **TanStack Query** ;
les flux temps réel (sessions, journal) par **Zustand** alimenté par les événements Tauri ; l'état purement
visuel (page, sélection) par un petit store Zustand.

## Développement

Prérequis : [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) 1.88+ (MSVC) et les
[prérequis Tauri](https://tauri.app/start/prerequisites/) pour Windows.

```bash
npm install
npm run app            # application complète (Tauri + Vite, rechargement à chaud)
npm run dev            # interface seule dans un navigateur, avec un faux backend
npm run app:build      # exécutable optimisé + installateur NSIS
```

Qualité :

```bash
npm run check          # typecheck + lint + tests frontend + clippy + tests Rust
```

Mettre à jour la liste de jeux embarquée (utilisée hors ligne en dernier recours) :

```bash
npm run gamelist:update
```

## Sécurité

- Les noms d'exécutables viennent d'une source externe : ils sont validés par segment avant de toucher au disque,
  et seuls les dossiers nommés d'après un identifiant Discord peuvent être supprimés par le nettoyage.
- La CSP est stricte (`default-src 'self'`) ; seules les icônes de `cdn.discordapp.com` sont autorisées.
- Le frontend n'a accès qu'aux commandes listées dans `src-tauri/src/lib.rs` et à l'ouverture de quelques URL.
- Aucune télémétrie. Les seules requêtes réseau sont le téléchargement de la liste de jeux (API publique de
  Discord) et le chargement des icônes.
- La seule lecture hors de l'application est celle du journal de Discord (lecture seule, limitée aux jeux lancés par
  l'application, désactivable), décrite plus haut.
- Le token Discord (fonction facultative des quêtes) est traité comme un secret : stockage dans le coffre de Windows,
  absent des journaux et des erreurs, jamais renvoyé à l'interface, requête limitée à `discord.com`.
- « Lancer au démarrage » n'écrit une entrée de démarrage Windows que si vous activez l'option, et la retire quand
  vous la désactivez.

## Limites connues

- **Windows uniquement** pour l'instant (le runner utilise l'API Win32). Le backend est structuré pour accueillir
  d'autres plateformes, mais rien n'a été testé ailleurs.
- Seuls les exécutables Windows déclarés par Discord et se terminant par `.exe` sont pris en charge.
- La Rich Presence emprunte l'identifiant d'application d'un vrai jeu : à vos risques.

## Mises à jour

L'application cherche une nouvelle version sur GitHub au démarrage puis toutes les quelques heures (réglable dans
**Réglages**, ou à la demande avec **Vérifier maintenant**). Quand une version existe, un bouton **Mettre à jour**
apparaît dans la barre latérale : il affiche les nouveautés, télécharge l'installateur, puis redémarre l'application.
Rien n'est installé sans accord, et un installateur dont la signature ne correspond pas à la clé publique de
`src-tauri/tauri.conf.json` est refusé.

### Publier une version

1. Augmentez la version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json`.
2. Créez et poussez le tag : `git tag v2.1.0 && git push origin v2.1.0`.
3. Le workflow **Release** compile, signe et crée une release en *brouillon* avec l'installateur, sa signature et
   `latest.json`. **Publiez-la** : tant qu'elle est en brouillon, les applications ne la voient pas.

### Clés de signature

La clé privée est dans `.secrets/updater.key` (dossier ignoré par git, ne jamais le publier ni le perdre : sans elle,
plus aucune mise à jour ne pourra être signée). Avant la première release, ajoutez dans
**GitHub → Settings → Secrets and variables → Actions** :

| Secret | Valeur |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | le contenu du fichier `.secrets/updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | vide (la clé générée n'a pas de mot de passe) |

La clé publique correspondante est dans `tauri.conf.json` (`plugins.updater.pubkey`). Pour changer de clé :
`npx tauri signer generate -w .secrets/updater.key`, puis remplacez `pubkey` ; les versions déjà installées ne
pourront plus se mettre à jour vers une version signée avec la nouvelle clé.

## Crédits

- **iSweat-exe** ([@iSweat-exe](https://github.com/iSweat-exe)) : auteur de cette réécriture.
- **Mark Terence Tiglao** ([markterence/discord-quest-completer](https://github.com/markterence/discord-quest-completer)) :
  auteur du projet d'origine, dont cette version est issue.

## Licence

[MIT](LICENSE) — © 2025 Mark Terence Tiglao (projet d'origine), © 2026 contributeurs de Discord Quest Completer.
