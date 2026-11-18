//! Strings shown by the native side (tray menu, notifications, fake game
//! windows). Everything else is translated by the frontend.

use crate::discord::SlowCause;
use crate::settings::Language;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Fr,
    En,
}

impl Lang {
    /// Resolves `Auto` from the operating system's language.
    pub fn resolve(language: Language) -> Self {
        match language {
            Language::Fr => Self::Fr,
            Language::En => Self::En,
            Language::Auto => sys_locale::get_locale()
                .filter(|locale| locale.to_ascii_lowercase().starts_with("fr"))
                .map_or(Self::En, |_| Self::Fr),
        }
    }

    /// Value of the runner's `--lang` argument.
    pub fn code(self) -> &'static str {
        match self {
            Self::Fr => "fr",
            Self::En => "en",
        }
    }

    pub fn tray_show(self) -> &'static str {
        match self {
            Self::Fr => "Afficher",
            Self::En => "Show",
        }
    }

    pub fn tray_stop_all(self) -> &'static str {
        match self {
            Self::Fr => "Arrêter toutes les sessions",
            Self::En => "Stop all sessions",
        }
    }

    pub fn tray_quit(self) -> &'static str {
        match self {
            Self::Fr => "Quitter",
            Self::En => "Quit",
        }
    }

    pub fn tray_tooltip(self, running: usize) -> String {
        match (self, running) {
            (_, 0) => "Discord Quest Completer".to_owned(),
            (Self::Fr, 1) => "Discord Quest Completer — 1 jeu en cours".to_owned(),
            (Self::Fr, count) => format!("Discord Quest Completer — {count} jeux en cours"),
            (Self::En, 1) => "Discord Quest Completer — 1 game running".to_owned(),
            (Self::En, count) => format!("Discord Quest Completer — {count} games running"),
        }
    }

    /// A running game in the tray menu: clicking it stops it.
    pub fn tray_stop_game(self, game: &str, timer: &str) -> String {
        match self {
            Self::Fr => format!("Arrêter {game} ({timer})"),
            Self::En => format!("Stop {game} ({timer})"),
        }
    }

    pub fn tray_waiting(self) -> &'static str {
        match self {
            Self::Fr => "en attente de Discord",
            Self::En => "waiting for Discord",
        }
    }

    pub fn tray_timer_done(self) -> &'static str {
        match self {
            Self::Fr => "minuteur terminé",
            Self::En => "timer complete",
        }
    }

    pub fn tray_remaining(self, minutes: i64, ends_at: &str) -> String {
        match self {
            Self::Fr => format!("encore {minutes} min, fin vers {ends_at}"),
            Self::En => format!("{minutes} min left, ends around {ends_at}"),
        }
    }

    pub fn tray_queue(self, playing: usize, waiting: usize) -> String {
        match (self, waiting) {
            (Self::Fr, 0) => format!("File de quêtes : {playing} en cours"),
            (Self::En, 0) => format!("Quest queue: {playing} playing"),
            (Self::Fr, _) => format!("File de quêtes : {playing} en cours, {waiting} en attente"),
            (Self::En, _) => format!("Quest queue: {playing} playing, {waiting} waiting"),
        }
    }

    pub fn tray_queue_stop(self) -> &'static str {
        match self {
            Self::Fr => "Arrêter la file",
            Self::En => "Stop the queue",
        }
    }

    pub fn tray_recent(self) -> &'static str {
        match self {
            Self::Fr => "Relancer un jeu récent",
            Self::En => "Relaunch a recent game",
        }
    }

    pub fn detected_title(self) -> &'static str {
        match self {
            Self::Fr => "Discord a détecté le jeu",
            Self::En => "Discord noticed the game",
        }
    }

    pub fn detected_body(self, game: &str) -> String {
        match self {
            Self::Fr => format!("{game} : le minuteur de quête démarre."),
            Self::En => format!("{game}: the quest timer starts."),
        }
    }

    pub fn slow_title(self) -> &'static str {
        match self {
            Self::Fr => "Discord ne voit pas encore le jeu",
            Self::En => "Discord does not see the game yet",
        }
    }

    pub fn slow_body(self, game: &str, cause: &SlowCause) -> String {
        match (self, cause) {
            (Self::Fr, SlowCause::DiscordNotRunning) => format!("{game} tourne, mais aucune application Discord n'est ouverte."),
            (Self::En, SlowCause::DiscordNotRunning) => format!("{game} is running, but no Discord desktop app is open."),
            (Self::Fr, SlowCause::UnsupportedClient(client)) => {
                format!("{client} ne détecte pas les jeux : ouvrez l'application Discord officielle.")
            }
            (Self::En, SlowCause::UnsupportedClient(client)) => {
                format!("{client} does not detect games: open the official Discord app.")
            }
            (Self::Fr, SlowCause::LogUnavailable) => {
                format!("Le journal de Discord est illisible : vérifiez dans Discord que {game} apparaît.")
            }
            (Self::En, SlowCause::LogUnavailable) => format!("Discord's log cannot be read: check in Discord that {game} shows up."),
            (Self::Fr, SlowCause::OtherPrimaryGame(other)) => {
                format!("Discord met {other} en avant : il ne confirme {game} qu'à son battement de 5 minutes.")
            }
            (Self::En, SlowCause::OtherPrimaryGame(other)) => {
                format!("Discord puts {other} forward: it confirms {game} only at its 5-minute heartbeat.")
            }
            (Self::Fr, SlowCause::Unknown) => {
                "Vérifiez que le partage de l'activité est activé (Paramètres Discord › Confidentialité des activités).".to_owned()
            }
            (Self::En, SlowCause::Unknown) => {
                "Check that activity sharing is on (Discord settings › Activity Privacy).".to_owned()
            }
        }
    }

    pub fn queue_done_title(self) -> &'static str {
        match self {
            Self::Fr => "File de quêtes terminée",
            Self::En => "Quest queue finished",
        }
    }

    pub fn queue_done_body(self, completed: usize, total: usize) -> String {
        match self {
            Self::Fr => format!("{completed} quête(s) sur {total} validée(s) par Discord."),
            Self::En => format!("{completed} of {total} quest(s) confirmed by Discord."),
        }
    }

    pub fn quest_notification_title(self) -> &'static str {
        match self {
            Self::Fr => "Minuteur de quête terminé",
            Self::En => "Quest timer complete",
        }
    }

    pub fn quest_notification_body(self, game: &str, minutes: u64) -> String {
        match self {
            Self::Fr => format!("{game} tourne depuis {minutes} min. Vérifiez la progression dans Discord."),
            Self::En => format!("{game} has been running for {minutes} min. Check your progress in Discord."),
        }
    }

    pub fn quest_done_title(self) -> &'static str {
        match self {
            Self::Fr => "Quête validée par Discord",
            Self::En => "Quest confirmed by Discord",
        }
    }

    pub fn quest_done_body(self, quest: &str) -> String {
        match self {
            Self::Fr => format!("{quest} est terminée."),
            Self::En => format!("{quest} is complete."),
        }
    }

    pub fn new_quests_title(self, count: usize) -> &'static str {
        match (self, count) {
            (Self::Fr, 1) => "Nouvelle quête Discord",
            (Self::Fr, _) => "Nouvelles quêtes Discord",
            (Self::En, 1) => "New Discord quest",
            (Self::En, _) => "New Discord quests",
        }
    }

    /// One quest is named; several are counted.
    pub fn new_quests_body(self, names: &[&str]) -> String {
        match (self, names) {
            (_, [name]) => (*name).to_owned(),
            (Self::Fr, _) => format!("{} nouvelles quêtes sont disponibles.", names.len()),
            (Self::En, _) => format!("{} new quests are available.", names.len()),
        }
    }

    pub fn new_video_quests_title(self, count: usize) -> &'static str {
        match (self, count) {
            (Self::Fr, 1) => "Nouvelle quête vidéo",
            (Self::Fr, _) => "Nouvelles quêtes vidéo",
            (Self::En, 1) => "New video quest",
            (Self::En, _) => "New video quests",
        }
    }

    pub fn new_video_quests_body(self, names: &[&str]) -> String {
        match (self, names) {
            (Self::Fr, [name]) => format!("{name} : acceptez-la puis lancez le visionnage depuis l'application."),
            (Self::En, [name]) => format!("{name}: accept it, then start the viewing from the app."),
            (Self::Fr, _) => format!("{} quêtes vidéo sont disponibles.", names.len()),
            (Self::En, _) => format!("{} video quests are available.", names.len()),
        }
    }

    pub fn expiring_quests_title(self, count: usize) -> &'static str {
        match (self, count) {
            (Self::Fr, 1) => "Une quête expire bientôt",
            (Self::Fr, _) => "Des quêtes expirent bientôt",
            (Self::En, 1) => "A quest expires soon",
            (Self::En, _) => "Quests expire soon",
        }
    }

    pub fn expiring_quests_body(self, names: &[&str]) -> String {
        match (self, names) {
            (Self::Fr, [name]) => format!("{name} expire dans moins de 24 h."),
            (Self::En, [name]) => format!("{name} expires in less than 24 h."),
            (Self::Fr, _) => format!("{} quêtes expirent dans moins de 24 h.", names.len()),
            (Self::En, _) => format!("{} quests expire in less than 24 h.", names.len()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn several_new_quests_are_counted_and_a_single_one_is_named() {
        assert_eq!(Lang::En.new_quests_body(&["Play Overwatch"]), "Play Overwatch");
        assert_eq!(Lang::En.new_quests_body(&["A", "B"]), "2 new quests are available.");
        assert_eq!(Lang::Fr.new_quests_title(1), "Nouvelle quête Discord");
        assert_eq!(Lang::Fr.new_quests_title(3), "Nouvelles quêtes Discord");
    }

    #[test]
    fn expiring_quests_are_named_or_counted() {
        assert!(Lang::Fr.expiring_quests_body(&["Fortnite"]).starts_with("Fortnite expire"));
        assert_eq!(Lang::En.expiring_quests_body(&["A", "B"]), "2 quests expire in less than 24 h.");
    }

    #[test]
    fn explicit_languages_ignore_the_system_locale() {
        assert_eq!(Lang::resolve(Language::Fr), Lang::Fr);
        assert_eq!(Lang::resolve(Language::En), Lang::En);
    }

    #[test]
    fn tray_tooltip_counts_running_games() {
        assert_eq!(Lang::En.tray_tooltip(0), "Discord Quest Completer");
        assert!(Lang::En.tray_tooltip(1).ends_with("1 game running"));
        assert!(Lang::Fr.tray_tooltip(3).ends_with("3 jeux en cours"));
    }

    #[test]
    fn language_codes_match_the_runner_arguments() {
        assert_eq!(Lang::Fr.code(), "fr");
        assert_eq!(Lang::En.code(), "en");
    }
}
